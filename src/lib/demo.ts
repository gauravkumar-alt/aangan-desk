import "server-only";
import { factsToCollectedData } from "./facts";
import { getStore } from "./store";
import type { EnquiryFacts, TranscriptTurn } from "./types";
import { sign, SIGNATURE_HEADER, EVENT_HEADER } from "./vaani/signature";
import { webhookSecret } from "./vaani/webhook";
import { vaaniProvider, webhookToken } from "./vaani/vaanivoice";

// Demo plumbing: turns a browser-simulated call into a real VaaniYantra-shaped webhook, signed with the
// webhook secret and POSTed to /api/vaani/webhook — the same door a live Vaani call comes through.

export interface SimCallBody {
  transcript: TranscriptTurn[];
  facts: EnquiryFacts;
  unknown: string[];
  declined: string[];
  ringStartedAt: string;
  answeredAt: string;
  endedAt: string;
  phone: string;
  endedEarly: boolean;
  repeatCaller: boolean;
  altPhone: string | null;
}

export const simId = () => `sim_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function deliverWebhook(origin: string, payload: unknown) {
  const { secret } = webhookSecret();
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json", [EVENT_HEADER]: (payload as { event: string }).event };
  if (secret) headers[SIGNATURE_HEADER] = sign(raw, secret);
  const res = await fetch(`${origin}/api/vaani/webhook`, { method: "POST", headers, body: raw, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, signature: headers[SIGNATURE_HEADER] ?? null };
}

async function postVaaniVoice(origin: string, payload: unknown) {
  const { token } = webhookToken();
  const res = await fetch(`${origin}/api/vaani/webhook?token=${encodeURIComponent(token ?? "")}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store" });
  return { status: res.status, body: await res.json().catch(() => ({})), signature: "token in URL (VaaniVoice has no signature header)" };
}

/** VaaniVoice: call_started → user_picked_up_at → call_ended → call_postprocessing, linked by room_name. */
async function simulateVaaniVoiceCall(origin: string, b: SimCallBody) {
  const id = simId();
  const room = `room_${id}`;
  const durationSec = Math.max(1, Math.round((new Date(b.endedAt).getTime() - new Date(b.answeredAt).getTime()) / 1000));
  const transcript = b.transcript.map((t) => `${t.role === "AGENT" ? "AGENT" : "USER"}: ${t.text}`).join("\n\n");
  const entities = factsToCollectedData(b.facts, b.unknown, b.declined, { call_ended_early: b.endedEarly, repeat_caller: b.repeatCaller, alternate_phone: b.altPhone });
  // Kept for the mock GET /api/call_details/{id}.
  await getStore().claimEvent({ key: `sim-call:${id}`, event: "sim.call", callId: id, receivedAt: new Date().toISOString(), status: "processed", enquiryId: null, error: null, attempts: 1, rawBody: JSON.stringify({ transcription: transcript, entity: entities, summary: null, conversation_eval: {}, call_eval_tag: null }) });
  await postVaaniVoice(origin, { event: "call_started", room_name: room, status: "started", phone_number: b.phone, timestamp: b.ringStartedAt });
  await postVaaniVoice(origin, { event: "user_picked_up_at", room_name: room, status: "picked_up", timestamp: b.answeredAt });
  await postVaaniVoice(origin, { event: "call_ended", room_name: room, call_duration: durationSec, end_reason: b.endedEarly ? "user_hangup" : "agent_ended_call", timestamp: b.endedAt });
  // With the "Vaani API fails" toggle on, the transcript isn't ready in the webhook (it can lag), so the app
  // has to fetch it from the call-details API — which then fails. Shows the enquiry surviving that.
  const lagging = (await getStore().getSettings()).simulateVaaniApiFailure;
  const payload = {
    event: "call_postprocessing",
    call_id: id,
    timestamp: new Date().toISOString(),
    data: { room_name: room, call_id: id, call_duration: durationSec * 1000, end_reason: b.endedEarly ? "user_hangup" : "agent_ended_call", summary: null, entities, dispositions: {}, recording_url: null, transcript: lagging ? "" : transcript },
  };
  const delivery = await postVaaniVoice(origin, payload);
  return { callId: id, delivery, payload };
}

export async function simulateCompletedCall(origin: string, b: SimCallBody) {
  if (vaaniProvider() !== "vaaniyantra") return simulateVaaniVoiceCall(origin, b);
  const id = simId();
  const durationSec = Math.max(1, Math.round((new Date(b.endedAt).getTime() - new Date(b.answeredAt).getTime()) / 1000));
  const call = {
    id,
    direction: "INBOUND",
    status: "COMPLETED",
    fromNumber: b.phone,
    toNumber: "+912000000000",
    durationSec,
    language: "en-IN",
    agent: { id: "demo-agent", name: "Aangan front desk (demo)" },
    summary: null,
    sentiment: null,
    sentimentScore: null,
    topics: [],
    collectedData: factsToCollectedData(b.facts, b.unknown, b.declined, { call_ended_early: b.endedEarly, repeat_caller: b.repeatCaller, alternate_phone: b.altPhone }),
    recordingUrl: null,
    createdAt: b.ringStartedAt,
    startedAt: b.answeredAt,
    endedAt: b.endedAt,
    transcript: b.transcript.map((t) => ({ role: t.role, text: t.text, atMs: t.atMs ?? 0 })),
  };
  // Keep the full call (with transcript) for the mock GET /api/v1/calls/:id.
  await getStore().claimEvent({ key: `sim-call:${id}`, event: "sim.call", callId: id, receivedAt: new Date().toISOString(), status: "processed", enquiryId: null, error: null, attempts: 1, rawBody: JSON.stringify(call) });
  // Webhook body exactly as documented: no transcript, no startedAt — those come from the API.
  const { transcript: _t, startedAt: _s, ...webhookData } = call;
  const payload = { event: "call.completed", timestamp: new Date().toISOString(), data: webhookData };
  const delivery = await deliverWebhook(origin, payload);
  return { callId: id, delivery, payload };
}

export async function simulateMissedCall(origin: string, phone: string) {
  if (vaaniProvider() !== "vaaniyantra") throw new Error("VaaniVoice answers every inbound call and has no missed-call event, so there's nothing to simulate.");
  const id = simId();
  const now = new Date().toISOString();
  const payload = { event: "call.failed", timestamp: now, data: { id, direction: "INBOUND", status: "NO_ANSWER", fromNumber: phone, toNumber: "+912000000000", durationSec: 0, createdAt: now, endedAt: now, collectedData: null } };
  return { callId: id, delivery: await deliverWebhook(origin, payload), payload };
}

/** Re-send the exact stored payload for a call — demonstrates idempotent processing. */
export async function redeliver(origin: string, callId: string) {
  const evs = await getStore().listEvents(2000);
  const vv = evs.find((e) => e.key === `vv:call_postprocessing:${callId}`);
  if (vv) return postVaaniVoice(origin, JSON.parse(vv.rawBody));
  const ev = evs.find((e) => e.callId === callId && e.event.startsWith("call."));
  if (!ev) throw new Error("No delivered webhook for that call");
  return deliverWebhook(origin, JSON.parse(ev.rawBody));
}

export async function getSimCall(callId: string) {
  const ev = (await getStore().listEvents(1000)).find((e) => e.key === `sim-call:${callId}`);
  return ev ? JSON.parse(ev.rawBody) : null;
}
