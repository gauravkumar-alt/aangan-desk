import "server-only";
import { createHash } from "crypto";
import { getStore } from "../store";
import type { CrmSync, Enquiry } from "../types";
import { hubspotProvider } from "./hubspot";
import { CrmError, type CrmProvider } from "./types";
import { zohoProvider } from "./zoho";

// CRM sync runs after the designer handoff and never blocks it. Provider is chosen by CRM_PROVIDER
// (zoho | hubspot); unset → whichever is configured, Zoho first. Safe to call repeatedly: the person is
// matched on phone, a deal is created at most once per enquiry, and a note is only added when something
// changed.

const PROVIDERS: Record<string, CrmProvider> = { zoho: zohoProvider, hubspot: hubspotProvider };

export function getCrm(): CrmProvider | null {
  const wanted = (process.env.CRM_PROVIDER || "").toLowerCase();
  if (wanted && PROVIDERS[wanted]) return PROVIDERS[wanted].configured() ? PROVIDERS[wanted] : null;
  return [zohoProvider, hubspotProvider].find((p) => p.configured()) ?? null;
}

export function crmStatus() {
  const active = getCrm();
  return { active: active?.id ?? null, label: active?.label ?? null, wanted: process.env.CRM_PROVIDER || "zoho" };
}

const empty = (provider: string): CrmSync => ({ provider, status: "PENDING", contactId: null, dealId: null, noteIds: [], syncedHash: null, lastError: null, attempts: [] });
const inFlight = new Set<string>();

export async function syncCrm(enquiryId: string): Promise<Enquiry | null> {
  const store = getStore();
  const provider = getCrm();
  if (!provider || inFlight.has(enquiryId)) return store.getEnquiry(enquiryId);
  inFlight.add(enquiryId);
  try {
    const e = await store.getEnquiry(enquiryId);
    if (!e) return null;
    // Switching providers starts a fresh record in the new CRM.
    const crm = e.crm && e.crm.provider === provider.id ? e.crm : empty(provider.id);
    const skip = async (reason: string) => {
      const updated = { ...e, crm: { ...crm, status: "SKIPPED" as const, skippedReason: reason } };
      await store.saveEnquiry(updated);
      return updated;
    };
    // Not a lead: replays (anonymised), missed calls with nothing said, superseded dropped calls, no number.
    if (e.source === "replay") return skip("Replayed September data — not written to the CRM.");
    if (!e.phone) return skip("No phone number captured.");
    if (e.supersededBy) return skip("Continued in a later call.");
    if (e.callStatus === "missed" || e.callStatus === "failed") return skip("Missed call — nothing captured yet.");

    const hash = createHash("sha256").update(JSON.stringify([e.qualificationStatus, e.qualificationReason, e.callerName, e.location, e.handoff.status])).digest("hex").slice(0, 16);
    if (crm.status === "SYNCED" && crm.syncedHash === hash && (e.qualificationStatus !== "QUALIFIED" || crm.dealId)) return e;

    const at = new Date().toISOString();
    const out: Partial<CrmSync> = {};
    try {
      await provider.sync(e, crm, crm.syncedHash !== hash, out);
      const updated = { ...e, crm: { ...crm, ...out, status: "SYNCED" as const, syncedHash: hash, lastError: null, attempts: [...crm.attempts, { at, ok: true }].slice(-20) } };
      await store.saveEnquiry(updated);
      return updated;
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[crm:${provider.id}] ${enquiryId}: ${msg}`);
      const hint = err instanceof CrmError && !err.retryable ? " (check credentials / required fields)" : "";
      const updated = { ...e, crm: { ...crm, ...out, status: "PENDING" as const, lastError: `${provider.label}: ${msg}${hint}`, attempts: [...crm.attempts, { at, ok: false, error: msg }].slice(-20) } };
      await store.saveEnquiry(updated);
      return updated;
    }
  } finally {
    inFlight.delete(enquiryId);
  }
}

export async function retryPendingCrm() {
  if (!getCrm()) return { attempted: 0, synced: 0 };
  const all = await getStore().listEnquiries();
  const pending = all.filter((e) => e.source !== "replay" && e.phone && !e.supersededBy && e.callStatus !== "missed" && e.callStatus !== "failed" && e.crm?.status !== "SYNCED" && e.crm?.status !== "SKIPPED");
  let synced = 0;
  for (const e of pending) if ((await syncCrm(e.id))?.crm?.status === "SYNCED") synced++;
  return { attempted: pending.length, synced };
}
