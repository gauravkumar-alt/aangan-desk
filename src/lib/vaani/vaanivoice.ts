import "server-only";
import { timingSafeEqual } from "crypto";
import { demoMode } from "../notify";
import { followUp, ingestCall, type CallInput } from "../process";
import { getStore } from "../store";
import type { Enquiry, TranscriptTurn, WebhookEventRecord } from "../types";

// VaaniVoice (app.vaanivoice.ai) — docs.vaanivoice.ai
//   Webhooks: Settings → Webhooks. Events used here (inbound): call_started (phone_number), user_picked_up_at,
//   call_ended (call_duration s, end_reason), call_postprocessing ({ call_id, data: { room_name, call_id,
//   call_duration ms, end_reason, summary, entities, dispositions, recording_url, transcript } }).
//   Lifecycle events and the post-call payload are linked by room_name.
//   API: GET https://api.vaanivoice.ai/api/call_details/{call_id}, header X-API-Key.
//   The docs describe no webhook signature, so the endpoint URL carries a secret token (?token=…), compared
//   in constant time. Env: VAANI_WEBHOOK_TOKEN, VAANI_API_KEY, VAANI_API_BASE (default https://api.vaanivoice.ai).

export const DEMO_TOKEN = "demo-token-local-only";

export function webhookToken(): { token: string | null; demo: boolean } {
  const t = process.env.VAANI_WEBHOOK_TOKEN;
  if (t) return { token: t, demo: false };
  return demoMode() ? { token: DEMO_TOKEN, demo: true } : { token: null, demo: false };
}

function tokenOk(given: string | null): boolean {
  const { token } = webhookToken();
  if (!token || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** "AGENT: …\n\n USER: …" (optionally with [00:12] timestamps) → turns. */
export function parseTranscript(text: unknown): TranscriptTurn[] {
  if (typeof text !== "string" || !text.trim() || /not available/i.test(text)) return [];
  const turns: TranscriptTurn[] = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim().replace(/^\[?\d{1,2}:\d{2}(:\d{2})?\]?\s*/, "");
    const m = /^(AGENT|ASSISTANT|BOT|AI|USER|CALLER|CUSTOMER|HUMAN)\s*:\s*(.*)$/i.exec(line);
    if (m) turns.push({ role: /^(AGENT|ASSISTANT|BOT|AI)$/i.test(m[1]) ? "AGENT" : "CALLER", text: m[2].trim() });
    else if (turns.length && line) turns[turns.length - 1].text += ` ${line}`;
  }
  return turns;
}

type Body = { event?: string; room_name?: string; call_id?: string; timestamp?: string; phone_number?: string; call_duration?: number; end_reason?: string; data?: Record<string, unknown>; [k: string]: unknown };

export type VvOutcome = { status: number; body: Record<string, unknown>; followUp?: () => Promise<void> };

export async function handleVaaniVoiceWebhook(raw: string, token: string | null, origin: string): Promise<VvOutcome> {
  if (!webhookToken().token) return { status: 503, body: { ok: false, error: "VAANI_WEBHOOK_TOKEN is not configured — refusing webhooks." } };
  if (!tokenOk(token)) {
    console.warn("[vaanivoice] rejected webhook: bad or missing token");
    return { status: 401, body: { ok: false, error: "Invalid token" } };
  }
  let b: Body;
  try {
    b = JSON.parse(raw);
  } catch {
    return { status: 400, body: { ok: false, error: "Body is not JSON" } };
  }
  const event = String(b.event ?? "");
  const data = (b.data ?? {}) as Record<string, unknown>;
  const room = String(b.room_name ?? data.room_name ?? "");
  const callId = String(b.call_id ?? data.call_id ?? room);
  // "Test Connectivity" pings and unknown shapes: acknowledge (token already verified) without storing anything.
  if (!event || !(room || callId)) {
    console.info("[vaanivoice] connectivity test / unrecognised payload acknowledged");
    return { status: 200, body: { ok: true, test: true } };
  }

  const store = getStore();
  const now = new Date().toISOString();
  const key = event === "call_postprocessing" ? `vv:${event}:${callId}` : `vv:${event}:${room}`;
  const rec: WebhookEventRecord = { key, event: `vv.${event}`, callId: room || callId, receivedAt: b.timestamp && !isNaN(Date.parse(b.timestamp)) ? new Date(b.timestamp).toISOString() : now, status: "processing", enquiryId: null, error: null, attempts: 1, rawBody: raw };
  let claim;
  try {
    claim = await store.claimEvent(rec);
  } catch (e) {
    console.error("[vaanivoice] could not record event:", e);
    return { status: 500, body: { ok: false, error: "Storage unavailable" } };
  }
  if (!claim.claimed) return { status: 200, body: { ok: true, duplicate: true, enquiryId: claim.existing?.enquiryId ?? undefined } };

  // Lifecycle events are just recorded; the post-call payload stitches them together.
  if (event !== "call_postprocessing") {
    await store.updateEvent(key, { status: "processed" });
    return { status: 200, body: { ok: true, recorded: event } };
  }

  let enquiry: Enquiry;
  try {
    enquiry = await ingestCall(await callInputFromPostprocessing(b, data, room, callId, now));
    await store.updateEvent(key, { status: "processed", enquiryId: enquiry.id, error: null });
  } catch (e) {
    console.error(`[vaanivoice] processing failed for ${key}:`, e);
    await store.updateEvent(key, { status: "failed", error: (e as Error).message }).catch(() => undefined);
    return { status: 500, body: { ok: false, error: "Processing failed — event stored for retry" } };
  }
  return { status: 200, body: { ok: true, enquiryId: enquiry.id }, followUp: () => followUp(enquiry.id, origin) };
}

async function lifecycle(room: string) {
  const evs = (await getStore().listEvents(2000)).filter((e) => e.callId === room && e.event.startsWith("vv."));
  const find = (name: string) => evs.find((e) => e.event === `vv.${name}`);
  const parse = (e?: WebhookEventRecord) => (e ? (JSON.parse(e.rawBody) as Body) : null);
  return { started: find("call_started"), picked: find("user_picked_up_at"), ended: find("call_ended"), startedBody: parse(find("call_started")), endedBody: parse(find("call_ended")) };
}

async function callInputFromPostprocessing(b: Body, data: Record<string, unknown>, room: string, callId: string, now: string): Promise<CallInput> {
  const lc = await lifecycle(room);
  const ms = typeof data.call_duration === "number" ? data.call_duration : null;
  const durationSec = typeof lc.endedBody?.call_duration === "number" ? lc.endedBody.call_duration : ms != null ? ms / 1000 : 0;
  const transcript = parseTranscript(data.transcript);
  const entities = data.entities && typeof data.entities === "object" ? (data.entities as Record<string, unknown>) : null;
  const createdAt = lc.started?.receivedAt ?? new Date(Date.parse(b.timestamp ?? now) - durationSec * 1000).toISOString();
  const endReason = String(data.end_reason ?? lc.endedBody?.end_reason ?? "");
  const dispositions = data.dispositions && typeof data.dispositions === "object" ? JSON.stringify(data.dispositions) : "";
  const early = entities?.call_ended_early === true || String(entities?.call_ended_early).toLowerCase() === "true";
  return {
    source: callId.startsWith("sim_") ? "simulator" : "vaani",
    vaaniCallId: callId,
    phone: (lc.startedBody?.phone_number as string | undefined) ?? (["caller_phone", "callback_number", "phone"].map((k) => entities?.[k]).find((v): v is string => typeof v === "string" && /\d{8,}/.test(v.replace(/\D/g, "")))?.replace(/[^\d+]/g, "") ?? null),
    createdAt,
    answeredAt: lc.picked?.receivedAt ?? lc.started?.receivedAt ?? null,
    endedAt: lc.ended?.receivedAt ?? b.timestamp ?? now,
    durationSec,
    status: early ? "hung_up_early" : "completed",
    transcript,
    transcriptStatus: transcript.length ? "complete" : "pending_fetch",
    collectedData: entities,
    summary: typeof data.summary === "string" ? data.summary : null,
    notes: [endReason && `End reason: ${endReason}`, dispositions && `Dispositions: ${dispositions}`, typeof data.recording_url === "string" ? `Recording: ${data.recording_url}` : ""].filter(Boolean).join(" · "),
  };
}

/** GET /api/call_details/{id} — transcript + entities when the webhook didn't carry them. */
export async function fetchCallDetails(callId: string, origin?: string) {
  const key = process.env.VAANI_API_KEY;
  const base = key ? (process.env.VAANI_API_BASE || "https://api.vaanivoice.ai").replace(/\/$/, "") : demoMode() && origin ? `${origin}/api/demo/vaani-mock` : null;
  if (!base) throw new Error("VAANI_API_KEY not configured — transcript can't be fetched.");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${base}/api/call_details/${encodeURIComponent(callId)}`, { headers: { "X-API-Key": key ?? "demo" }, signal: ctl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`VaaniVoice API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
    const j = (await res.json()) as { transcription?: unknown; entity?: unknown; summary?: unknown };
    return {
      transcript: parseTranscript(j.transcription),
      entities: j.entity && typeof j.entity === "object" ? (j.entity as Record<string, unknown>) : null,
      summary: typeof j.summary === "string" && !/not available/i.test(j.summary) ? j.summary : null,
    };
  } catch (e) {
    throw new Error((e as Error).name === "AbortError" ? "VaaniVoice API timed out after 8s" : (e as Error).message);
  } finally {
    clearTimeout(t);
  }
}

export const vaaniProvider = () => (process.env.VAANI_PROVIDER || "vaanivoice").toLowerCase();
