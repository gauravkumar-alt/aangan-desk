import "server-only";
// The enquiry pipeline. Order matters: the enquiry is SAVED before anything that talks to the outside
// world (Vaani API, Telegram). A downstream failure leaves a stored enquiry with a visible, retryable
// state — never a lost lead.

import { computeCost } from "./cost";
import { mergeFacts } from "./facts";
import { buildHandoffNote } from "./handoff";
import { isWithinHours } from "./hours";
import { getNotifier, type Notifier } from "./notify";
import { demoInboxNotifier } from "./notify/demo";
import { indicativePrice } from "./pricing";
import { qualify } from "./qualify";
import { loadRuleset } from "./rules/load";
import type { Ruleset } from "./rules/schema";
import { getStore } from "./store";
import type { CallStatus, Correction, Enquiry, EnquiryFacts, EnquirySource, Settings, TranscriptTurn } from "./types";
import { EMPTY_FACTS } from "./types";
import { getCall } from "./vaani/client";
import { syncCrm } from "./crm";
import { normalizeCall } from "./vaani/normalize";
import type { VaaniCall } from "./vaani/payload";

export interface CallInput {
  source: EnquirySource;
  vaaniCallId: string | null;
  phone: string | null;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number;
  status: CallStatus;
  transcript: TranscriptTurn[];
  transcriptStatus: Enquiry["transcriptStatus"];
  collectedData: Record<string, unknown> | null;
  summary: string | null;
  vaaniCostInr?: number | null;
  replayOf?: string;
  notes?: string;
  previousEnquiryId?: string | null;
}

const safeId = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
export const enquiryIdForCall = (callId: string) => `enq_${safeId(callId)}`;

/** Recompute everything derived from facts: pricing, qualification, handoff note, cost. Pure given inputs. */
export function derive(e: Enquiry, rules: Ruleset, settings: Settings, opts: { vaaniCostInr?: number | null } = {}): Enquiry {
  const now = new Date(e.createdAt);
  let pricing = indicativePrice(e, rules);
  const q = qualify(e, rules, {
    now,
    callStatus: e.callStatus,
    afterHours: e.afterHours,
    pricing,
    repeatCaller: e.repeatCaller,
    unknownFields: e.unknownFields,
    declinedFields: e.declinedFields,
  });
  // A person reviewed a NEEDS REVIEW enquiry: their decision stands (and is labelled as theirs).
  if (e.review && q.status === "NEEDS_REVIEW" && q.handoffKind !== "escalation") {
    if (e.review.decision === "approved") {
      q.status = "QUALIFIED";
      q.reason = `Approved by the front desk after review${e.review.note ? ` (${e.review.note})` : ""}. Originally: ${q.reason}`;
      q.handoffKind = "designer";
      q.nextAction = "Designer to call back and book the free consultation.";
    } else {
      q.status = "NOT_QUALIFIED";
      q.reason = `Closed by the front desk after review${e.review.note ? ` (${e.review.note})` : ""}. Originally: ${q.reason}`;
      q.nextAction = "No follow-up.";
    }
  }
  // Per the studio's flow, not-qualified callers are recorded and closed — no price attached.
  if (q.status === "NOT_QUALIFIED" && pricing.status === "estimated") pricing = { ...pricing, status: "not_applicable", minInr: null, maxInr: null, basis: "Not qualified — no price given." };
  const cost = e.callStatus === "missed" || e.callStatus === "failed" ? computeCost(0, settings) : computeCost(e.callDurationSeconds, settings, opts.vaaniCostInr ?? (e.cost?.basis === "vaani_reported" ? e.cost.estimatedInr : null));

  const next: Enquiry = {
    ...e,
    qualificationStatus: q.status,
    qualificationReason: q.reason,
    checks: q.checks,
    flags: q.flags,
    missingInfo: q.missingInfo,
    recommendedNextAction: q.nextAction,
    rulesStatus: [rules.qualified.status, rules.pricing.status].filter(Boolean).join(" / ") || "rules missing",
    pricing,
    indicativePriceMin: pricing.minInr,
    indicativePriceMax: pricing.maxInr,
    cost,
    aiCost: cost.estimatedInr,
    updatedAt: new Date().toISOString(),
  };

  // Handoff: once SENT it stays sent (we never un-send). Otherwise it follows the current qualification.
  const kind = q.handoffKind;
  if (next.handoff.status === "SENT") {
    next.handoff = { ...next.handoff, note: kind ? buildHandoffNote(next, kind) : next.handoff.note };
  } else if (kind) {
    next.handoff = { ...next.handoff, required: true, kind, status: "PENDING", note: buildHandoffNote(next, kind) };
  } else {
    next.handoff = { ...next.handoff, required: false, kind: null, status: "NOT_REQUIRED", note: null, lastError: null };
  }
  next.handoffRequired = next.handoff.required;
  next.handoffStatus = next.handoff.status;
  return next;
}

export async function buildFromCall(input: CallInput, rules: Ruleset, settings: Settings): Promise<{ enquiry: Enquiry; superseded: Enquiry[] }> {
  const store = getStore();
  const created = new Date(input.createdAt);
  const id = input.replayOf ? `enq_replay_${safeId(input.replayOf)}` : input.vaaniCallId ? enquiryIdForCall(input.vaaniCallId) : `enq_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  const norm = input.status === "missed" || input.status === "failed" ? null : normalizeCall(input.collectedData, input.transcript, created);
  let facts: EnquiryFacts = norm?.facts ?? { ...EMPTY_FACTS, spaces: [] };
  const corrections: Correction[] = norm?.corrections ?? [];
  let repeatCaller = norm?.repeatCaller ?? false;
  const superseded: Enquiry[] = [];

  // Same caller again? Carry forward what a dropped call captured; flag genuine repeat callers.
  let previousEnquiryId = input.previousEnquiryId ?? null;
  if (input.phone && !input.replayOf) {
    const since = new Date(created.getTime() - 7 * 864e5).toISOString();
    const prior = (await store.findRecentByPhone(input.phone, since)).filter((p) => p.id !== id && p.createdAt <= input.createdAt);
    const recentUnfinished = prior
      .filter((p) => (p.callStatus === "hung_up_early" || p.callStatus === "missed" || p.callStatus === "failed") && !p.supersededBy && created.getTime() - new Date(p.createdAt).getTime() < 2 * 3600e3)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (recentUnfinished.length && input.status !== "missed" && input.status !== "failed") {
      const p = recentUnfinished[0];
      previousEnquiryId = p.id;
      facts = mergeFacts(pickFacts(p), facts, input.createdAt, { track: false }).facts;
      for (const u of recentUnfinished) superseded.push({ ...u, supersededBy: id, updatedAt: new Date().toISOString() });
    }
    // Called before and that enquiry is still waiting on us (not handed off, not closed) — T16's situation.
    if (prior.some((p) => p.callStatus === "completed" && !p.supersededBy && p.handoff.status !== "SENT" && p.qualificationStatus !== "NOT_QUALIFIED")) repeatCaller = true;
  }
  if (input.previousEnquiryId) {
    const p = await store.getEnquiry(input.previousEnquiryId);
    if (p) {
      facts = mergeFacts(pickFacts(p), facts, input.createdAt, { track: false }).facts;
      superseded.push({ ...p, supersededBy: id, updatedAt: new Date().toISOString() });
    }
  }

  const answeredAt = input.answeredAt;
  const base: Enquiry = {
    ...facts,
    id,
    createdAt: input.createdAt,
    source: input.source,
    vaaniCallId: input.vaaniCallId,
    phone: input.phone,
    callStatus: input.status,
    answeredAt,
    endedAt: input.endedAt,
    answerDelaySec: answeredAt ? Math.max(0, Math.round((new Date(answeredAt).getTime() - created.getTime()) / 1000)) : null,
    afterHours: !isWithinHours(created, rules.services.rules?.hours),
    callDurationSeconds: Math.max(0, Math.round(input.durationSec || 0)),
    qualificationStatus: "PENDING",
    qualificationReason: "",
    checks: [],
    flags: [],
    missingInfo: [],
    unknownFields: norm?.unknown ?? [],
    declinedFields: norm?.declined ?? [],
    corrections,
    recommendedNextAction: "",
    rulesStatus: "",
    pricing: { status: "insufficient_info", minInr: null, maxInr: null, rateId: null, basis: "", alternatives: [], source: "none", internalOnly: true, disclaimer: "" },
    indicativePriceMin: null,
    indicativePriceMax: null,
    handoffRequired: false,
    handoffStatus: "NOT_REQUIRED",
    handoff: { required: false, kind: null, status: "NOT_REQUIRED", channel: null, attempts: [], sentAt: null, lastError: null, note: null },
    aiCost: 0,
    cost: computeCost(0, settings),
    transcript: input.transcript,
    transcriptStatus: input.transcriptStatus,
    summary: input.summary,
    notes: input.notes ?? "",
    outcome: { status: "open", valueInr: null, recordedAt: null, note: null },
    review: null,
    consultation: null,
    crm: null,
    repeatCaller,
    previousEnquiryId,
    supersededBy: null,
    replayOf: input.replayOf,
    processingErrors: [],
    updatedAt: new Date().toISOString(),
  };
  return { enquiry: derive(base, rules, settings, { vaaniCostInr: input.vaaniCostInr }), superseded };
}

function pickFacts(e: Enquiry): EnquiryFacts {
  const out = { ...EMPTY_FACTS, spaces: [] } as EnquiryFacts;
  for (const k of Object.keys(EMPTY_FACTS) as (keyof EnquiryFacts)[]) (out as unknown as Record<string, unknown>)[k] = e[k];
  return out;
}

/** Persist a call as an enquiry (and any earlier dropped call it continues). Fast, local, no network. */
export async function ingestCall(input: CallInput): Promise<Enquiry> {
  const store = getStore();
  const [rules, settings] = await Promise.all([loadRuleset(), store.getSettings()]);
  const existing = input.vaaniCallId ? await store.findByVaaniCallId(input.vaaniCallId) : null;
  const { enquiry, superseded } = await buildFromCall(input, rules, settings);
  // Re-delivery for a call we already have: keep its handoff history and any human-entered outcome.
  const toSave = existing ? { ...enquiry, handoff: existing.handoff.status === "SENT" ? { ...enquiry.handoff, ...existing.handoff, note: enquiry.handoff.note } : enquiry.handoff, outcome: existing.outcome, review: existing.review, consultation: existing.consultation, crm: existing.crm } : enquiry;
  if (existing?.handoff.status === "SENT") {
    toSave.handoffStatus = "SENT";
  }
  await store.saveEnquiry(toSave);
  for (const s of superseded) await store.saveEnquiry(s);
  return toSave;
}

/** Map a VaaniYantra call object (webhook data or GET /calls/:id) to pipeline input. */
export function callInputFromVaani(event: string, call: VaaniCall, source: EnquirySource = "vaani"): CallInput {
  const failed = event === "call.failed" || ["FAILED", "NO_ANSWER", "BUSY"].includes((call.status ?? "").toUpperCase());
  const cd = (call.collectedData ?? null) as Record<string, unknown> | null;
  const transcript: TranscriptTurn[] = (call.transcript ?? []).map((t) => ({ role: t.role.toUpperCase() === "AGENT" ? "AGENT" : "CALLER", text: t.text, atMs: t.atMs }));
  const createdAt = call.createdAt ?? call.startedAt ?? new Date().toISOString();
  const durationSec = call.durationSec ?? 0;
  const endedEarly = cd?.call_ended_early === true || cd?.call_ended_early === "true";
  return {
    source,
    vaaniCallId: call.id,
    phone: call.fromNumber ?? null,
    createdAt,
    answeredAt: failed ? null : call.startedAt ?? null,
    endedAt: call.endedAt ?? null,
    durationSec,
    status: failed ? ((call.status ?? "").toUpperCase() === "FAILED" ? "failed" : "missed") : endedEarly ? "hung_up_early" : "completed",
    transcript,
    transcriptStatus: transcript.length ? "complete" : failed ? "not_available" : "pending_fetch",
    collectedData: cd,
    summary: call.summary ?? null,
    vaaniCostInr: typeof cd?.cost_inr === "number" ? (cd.cost_inr as number) : null,
  };
}

/** Webhook gave us no transcript/startedAt: fetch the full call from Vaani and re-derive. */
export async function enrichFromVaani(enquiryId: string, origin?: string): Promise<Enquiry | null> {
  const store = getStore();
  const e = await store.getEnquiry(enquiryId);
  if (!e || !e.vaaniCallId || e.transcriptStatus === "complete" || e.transcriptStatus === "not_available") return e;
  const settings = await store.getSettings();
  try {
    if (settings.simulateVaaniApiFailure) throw new Error("Vaani API 503 (simulated failure — demo toggle is on)");
    const rules = await loadRuleset();
    let input: CallInput;
    const { vaaniProvider, fetchCallDetails } = await import("./vaani/vaanivoice");
    if (vaaniProvider() === "vaaniyantra") {
      const call = await getCall(e.vaaniCallId, origin);
      input = callInputFromVaani("call.completed", { ...call, collectedData: call.collectedData ?? null }, e.source);
    } else {
      // VaaniVoice call details carry transcript + entities; phone and times come from what we already stored.
      const d = await fetchCallDetails(e.vaaniCallId, origin);
      input = {
        source: e.source,
        vaaniCallId: e.vaaniCallId,
        phone: e.phone,
        createdAt: e.createdAt,
        answeredAt: e.answeredAt,
        endedAt: e.endedAt,
        durationSec: e.callDurationSeconds,
        status: e.callStatus,
        transcript: d.transcript,
        transcriptStatus: "complete",
        collectedData: d.entities,
        summary: d.summary ?? e.summary,
        notes: e.notes,
      };
    }
    input.previousEnquiryId = null;
    const rebuilt = (await buildFromCall({ ...input, transcriptStatus: input.transcript.length ? "complete" : "not_available" }, rules, settings)).enquiry;
    const merged: Enquiry = derive(
      { ...rebuilt, handoff: e.handoff, outcome: e.outcome, review: e.review, consultation: e.consultation, crm: e.crm, previousEnquiryId: e.previousEnquiryId ?? rebuilt.previousEnquiryId, notes: e.notes || rebuilt.notes, processingErrors: e.processingErrors },
      rules,
      settings,
    );
    await store.saveEnquiry(merged);
    return merged;
  } catch (err) {
    const msg = (err as Error).message;
    const updated: Enquiry = { ...e, transcriptStatus: "fetch_failed", processingErrors: [...e.processingErrors, `${new Date().toISOString()} transcript fetch: ${msg}`].slice(-10), updatedAt: new Date().toISOString() };
    await store.saveEnquiry(updated);
    console.error(`[vaani] transcript fetch failed for ${e.vaaniCallId}: ${msg}`);
    return updated;
  }
}

const inFlight = new Set<string>();

/** Send (or retry) the handoff. Safe to call repeatedly: a SENT handoff is never sent twice. */
export async function dispatchHandoff(enquiryId: string, opts: { notifier?: Notifier; force?: boolean } = {}): Promise<Enquiry | null> {
  if (inFlight.has(enquiryId)) return getStore().getEnquiry(enquiryId);
  inFlight.add(enquiryId);
  try {
    const store = getStore();
    const e = await store.getEnquiry(enquiryId);
    if (!e) return null;
    if (!e.handoff.required || !e.handoff.note || !e.handoff.kind) return e;
    if (e.handoff.status === "SENT" && !opts.force) return e;
    const settings = await store.getSettings();
    const notifier = opts.notifier ?? (e.source === "replay" ? demoInboxNotifier("replayed Sep 2026 data — never sent to Telegram") : getNotifier());
    const at = new Date().toISOString();
    const res = settings.simulateHandoffFailure && e.source !== "replay"
      ? { ok: false, error: `${notifier.label}: simulated failure (demo toggle is on)`, retryable: true }
      : await notifier.send(e.handoff.note, e, e.handoff.kind);
    const attempts = [...e.handoff.attempts, { at, channel: notifier.id, ok: res.ok, error: res.error, externalId: res.externalId }].slice(-20);
    const handoff = res.ok
      ? { ...e.handoff, status: "SENT" as const, channel: notifier.id, attempts, sentAt: at, lastError: null }
      : { ...e.handoff, status: "PENDING" as const, channel: notifier.id, attempts, lastError: res.error ?? "Unknown error" };
    if (!res.ok) console.error(`[handoff] ${enquiryId} via ${notifier.id} failed: ${res.error}`);
    const updated = { ...e, handoff, handoffStatus: handoff.status, updatedAt: at };
    await store.saveEnquiry(updated);
    return updated;
  } finally {
    inFlight.delete(enquiryId);
  }
}

/** After ingest: enrich (if needed) then hand off. Each step catches its own failures. */
export async function followUp(enquiryId: string, origin?: string) {
  try {
    await enrichFromVaani(enquiryId, origin);
  } catch (e) {
    console.error(`[followUp] enrich ${enquiryId}:`, e);
  }
  try {
    await dispatchHandoff(enquiryId);
  } catch (e) {
    console.error(`[followUp] handoff ${enquiryId}:`, e);
  }
  try {
    await syncCrm(enquiryId); // after the handoff: the designer never waits on the CRM
  } catch (e) {
    console.error(`[followUp] crm ${enquiryId}:`, e);
  }
}

/** Retry every pending handoff (dashboard button / cron). */
export async function retryPendingHandoffs() {
  const all = await getStore().listEnquiries();
  const pending = all.filter((e) => e.handoff.required && e.handoff.status === "PENDING");
  const results = [];
  for (const e of pending) results.push(await dispatchHandoff(e.id));
  return { attempted: pending.length, sent: results.filter((r) => r?.handoff.status === "SENT").length };
}

/** Re-run qualification for every stored enquiry (after rules files or cost settings change). */
export async function rederiveAll() {
  const store = getStore();
  const [rules, settings, all] = await Promise.all([loadRuleset(), store.getSettings(), store.listEnquiries()]);
  for (const e of all) await store.saveEnquiry(derive(e, rules, settings));
  return all.length;
}
