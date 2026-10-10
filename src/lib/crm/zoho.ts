import "server-only";
import type { Enquiry } from "../types";
import { CrmError, type CrmProvider } from "./types";

// Zoho CRM (REST v8) — works on the Free edition (5,000 API credits / 24h; ~4–8 credits per call here).
// Auth: a Self Client in https://api-console.zoho.in → generate a refresh token with scopes
//   ZohoCRM.modules.leads.ALL,ZohoCRM.modules.contacts.ALL,ZohoCRM.modules.deals.ALL,ZohoCRM.modules.notes.ALL
// Env: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_DC (in | com | eu | com.au …, default "in"),
//      optional ZOHO_DEAL_STAGE (default "Qualification").
//
// Flow per call (Zoho's standard lead lifecycle):
//   every caller        → Lead upserted on Phone, Lead_Status from the qualification, note with the summary
//   qualified enquiry   → Lead converted once → Contact + Deal (Amount = low end of the INTERNAL range)
//   after conversion    → further notes go on the Contact (the Lead no longer exists)

const dc = () => process.env.ZOHO_DC || "in";
const apiBase = () => `https://www.zohoapis.${dc()}/crm/v8`;

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const p = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
    client_id: process.env.ZOHO_CLIENT_ID!,
    client_secret: process.env.ZOHO_CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
  const res = await timed(`https://accounts.zoho.${dc()}/oauth/v2/token?${p}`, { method: "POST" });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !j.access_token) throw new CrmError(`Zoho auth failed: ${j.error ?? res.status} (check client id/secret/refresh token and ZOHO_DC)`, res.status >= 500);
  token = { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return token.value;
}

async function timed(url: string, init: RequestInit) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, cache: "no-store" });
  } catch (e) {
    throw new CrmError((e as Error).name === "AbortError" ? "Zoho timed out after 8s" : `Network error reaching Zoho: ${(e as Error).message}`, true);
  } finally {
    clearTimeout(t);
  }
}

type ZohoRow = { code?: string; status?: string; message?: string; details?: Record<string, unknown> };

async function zoho(method: string, path: string, body?: unknown): Promise<{ data?: ZohoRow[] } & Record<string, unknown>> {
  const res = await timed(`${apiBase()}${path}`, {
    method,
    headers: { Authorization: `Zoho-oauthtoken ${await accessToken()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const j = (await res.json().catch(() => ({}))) as { data?: ZohoRow[]; message?: string; code?: string };
  if (res.status === 401) token = null; // expired/revoked — next attempt refreshes
  if (!res.ok) throw new CrmError(`Zoho ${res.status}: ${j.message ?? j.data?.[0]?.message ?? j.code ?? res.statusText}`, res.status === 429 || res.status >= 500 || res.status === 401);
  const row = j.data?.[0];
  if (row?.status === "error") throw new CrmError(`Zoho: ${row.message ?? row.code}`, false);
  return j;
}

const idOf = (v: unknown): string | null => (typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String((v as { id: unknown }).id) : null);

function leadFields(e: Enquiry) {
  const [first, ...rest] = (e.callerName ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    // Last_Name is mandatory in Zoho; without a name we use the caller's number so the record is findable.
    Last_Name: rest.join(" ") || first || `Caller ${e.phone}`,
    ...(rest.length ? { First_Name: first } : {}),
    Phone: e.phone,
    City: e.location ? e.location.split(",").slice(-1)[0].trim() : undefined,
    Lead_Status: e.qualificationStatus === "QUALIFIED" ? "Pre-Qualified" : e.qualificationStatus === "NOT_QUALIFIED" ? "Not Qualified" : "Not Contacted",
    Description: `AI front desk: ${e.qualificationReason}`.slice(0, 2000),
  };
}

function noteText(e: Enquiry) {
  return [`${e.qualificationStatus.replace("_", " ")} — ${e.qualificationReason}`, `Next step: ${e.recommendedNextAction}`, e.handoff.note?.text ?? ""].filter(Boolean).join("\n\n").slice(0, 30000);
}

export const zohoProvider: CrmProvider = {
  id: "zoho",
  label: "Zoho CRM",
  configured: () => Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN),

  async sync(e, prev, writeNote, next) {
    let parentModule: "Leads" | "Contacts" = prev.recordType === "Contact" ? "Contacts" : "Leads";
    let parentId = prev.contactId;

    if (prev.recordType !== "Contact") {
      // Upsert the lead on Phone (Zoho's duplicate check) — repeat callers update the same lead.
      const up = await zoho("POST", "/Leads/upsert", { data: [leadFields(e)], duplicate_check_fields: ["Phone"], trigger: [] });
      parentId = idOf(up.data?.[0]?.details?.id) ?? parentId;
      if (!parentId) throw new CrmError("Zoho upsert returned no record id", true);
      next.contactId = parentId;
      next.recordType = "Lead";
      parentModule = "Leads";
    }

    if (writeNote && parentId) {
      const n = await zoho("POST", `/${parentModule}/${parentId}/Notes`, { data: [{ Note_Title: `Aangan AI front desk — ${e.qualificationStatus.replace("_", " ")}`, Note_Content: noteText(e) }] });
      const nid = idOf(n.data?.[0]?.details?.id);
      if (nid) next.noteIds = [...prev.noteIds, nid].slice(-20);
    }

    if (e.qualificationStatus === "QUALIFIED" && !prev.dealId && parentModule === "Leads" && parentId) {
      const close = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10); // placeholder close date — Zoho requires one
      const deal: Record<string, unknown> = {
        Deal_Name: `${e.callerName ?? e.phone} — ${e.propertyType ?? e.projectType ?? "Interiors"}${e.location ? `, ${e.location.split(",")[0]}` : ""}`,
        Stage: process.env.ZOHO_DEAL_STAGE || "Qualification",
        Closing_Date: close,
        Description: `Qualified by the AI front desk. ${e.qualificationReason}${e.pricing.status === "estimated" ? ` Amount = low end of the INTERNAL indicative range (${e.pricing.basis}) — an estimate, not a quote. Closing date is a placeholder.` : " Closing date is a placeholder."}`,
      };
      if (e.pricing.status === "estimated" && e.indicativePriceMin) deal.Amount = e.indicativePriceMin;
      const conv = await zoho("POST", `/Leads/${parentId}/actions/convert`, { data: [{ overwrite: true, notify_lead_owner: false, notify_new_entity_owner: false, Deals: deal }] });
      // v8 returns ids under details; older versions at the row's top level — accept both.
      const row = (conv.data?.[0] ?? {}) as Record<string, unknown>;
      const d = (row.details ?? row) as Record<string, unknown>;
      next.dealId = idOf(d.Deals);
      next.contactId = idOf(d.Contacts) ?? parentId;
      next.recordType = "Contact";
      if (!next.dealId) throw new CrmError("Zoho lead conversion returned no deal id", true);
    }
  },
};
