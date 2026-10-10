import "server-only";
import { demoMode } from "../notify";
import { callInputFromVaani, followUp, ingestCall } from "../process";
import { getStore } from "../store";
import type { Enquiry } from "../types";
import { idempotencyKey, VaaniWebhook } from "./payload";
import { verifySignature } from "./signature";

// Used only when DEMO_MODE is on and no real secret is configured, so the simulator can exercise the
// exact same signature check. With DEMO_MODE=false a missing secret rejects every webhook (fail closed).
export const DEMO_WEBHOOK_SECRET = "whsec_demo_local_only_not_for_production";

export function webhookSecret(): { secret: string | null; demo: boolean } {
  const s = process.env.VAANI_WEBHOOK_SECRET;
  if (s) return { secret: s, demo: false };
  return demoMode() ? { secret: DEMO_WEBHOOK_SECRET, demo: true } : { secret: null, demo: false };
}

export type WebhookOutcome =
  | { status: 200; body: { ok: true; duplicate?: boolean; ignored?: string; enquiryId?: string } ; followUp?: () => Promise<void> }
  | { status: 400 | 401 | 500 | 503; body: { ok: false; error: string } };

/**
 * Verify → parse → claim idempotency key → store enquiry (synchronously, before replying) → schedule
 * enrichment + handoff for after the response. The caller must respond within Vaani's 6s timeout.
 */
export async function handleVaaniWebhook(rawBody: string, signature: string | null, origin: string): Promise<WebhookOutcome> {
  const { secret } = webhookSecret();
  if (!secret) return { status: 503, body: { ok: false, error: "VAANI_WEBHOOK_SECRET is not configured — refusing unsigned webhooks." } };
  if (!verifySignature(rawBody, signature, secret)) {
    console.warn("[vaani] rejected webhook: bad or missing signature");
    return { status: 401, body: { ok: false, error: "Invalid signature" } };
  }

  let payload: VaaniWebhook;
  try {
    const parsed = VaaniWebhook.safeParse(JSON.parse(rawBody));
    if (!parsed.success) return { status: 400, body: { ok: false, error: `Unexpected payload: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` } };
    payload = parsed.data;
  } catch {
    return { status: 400, body: { ok: false, error: "Body is not JSON" } };
  }

  if (!["call.completed", "call.failed"].includes(payload.event)) return { status: 200, body: { ok: true, ignored: `event ${payload.event}` } };
  if (payload.data.direction && payload.data.direction.toUpperCase() !== "INBOUND") {
    return { status: 200, body: { ok: true, ignored: "outbound calls are out of scope" } };
  }

  const store = getStore();
  const key = idempotencyKey(payload);
  const now = new Date().toISOString();
  let claim;
  try {
    claim = await store.claimEvent({ key, event: payload.event, callId: payload.data.id, receivedAt: now, status: "processing", enquiryId: null, error: null, attempts: 1, rawBody });
  } catch (e) {
    console.error("[vaani] could not record webhook event:", e);
    return { status: 500, body: { ok: false, error: "Storage unavailable" } };
  }
  if (!claim.claimed) {
    console.info(`[vaani] duplicate delivery ignored: ${key}`);
    return { status: 200, body: { ok: true, duplicate: true, enquiryId: claim.existing?.enquiryId ?? undefined } };
  }

  let enquiry: Enquiry;
  try {
    enquiry = await ingestCall(callInputFromVaani(payload.event, payload.data, payload.data.id.startsWith("sim_") ? "simulator" : "vaani"));
    await store.updateEvent(key, { status: "processed", enquiryId: enquiry.id, error: null });
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[vaani] processing failed for ${key}:`, e);
    await store.updateEvent(key, { status: "failed", error: msg }).catch(() => undefined);
    // 500 lets a retrying sender try again; the raw body is kept so it can be reprocessed from the app.
    return { status: 500, body: { ok: false, error: "Processing failed — event stored for retry" } };
  }

  return { status: 200, body: { ok: true, enquiryId: enquiry.id }, followUp: () => followUp(enquiry.id, origin) };
}

/** Reprocess a stored event that failed (from the integration panel). */
export async function reprocessEvent(key: string, origin: string) {
  const store = getStore();
  const ev = (await store.listEvents(500)).find((e) => e.key === key);
  if (!ev) throw new Error("Event not found");
  if (ev.status !== "failed") return { skipped: true };
  const payload = VaaniWebhook.parse(JSON.parse(ev.rawBody));
  const claim = await store.claimEvent({ ...ev, status: "processing", receivedAt: ev.receivedAt });
  if (!claim.claimed) return { skipped: true };
  const enquiry = await ingestCall(callInputFromVaani(payload.event, payload.data));
  await store.updateEvent(key, { status: "processed", enquiryId: enquiry.id, error: null });
  await followUp(enquiry.id, origin);
  return { enquiryId: enquiry.id };
}
