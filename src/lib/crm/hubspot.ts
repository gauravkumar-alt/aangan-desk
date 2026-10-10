import "server-only";
import type { Enquiry } from "../types";
import { CrmError, type CrmProvider } from "./types";

// HubSpot CRM v3 via a private app token (Settings → Integrations → Private Apps).
// Scopes: crm.objects.contacts.read, crm.objects.contacts.write, crm.objects.deals.write.
// Env: HUBSPOT_TOKEN, optional HUBSPOT_PIPELINE (default "default"), HUBSPOT_DEAL_STAGE (default "appointmentscheduled").
//
// Per call: upsert the contact (matched on phone), add a note with the qualification summary, and for
// qualified enquiries create one deal linked to the contact. Aangan's CRM stays the system of record for
// sales — this only feeds it.

const BASE = "https://api.hubapi.com";
// HubSpot-defined association type ids (v4 association labels)
const NOTE_TO_CONTACT = 202;
const DEAL_TO_CONTACT = 3;

const HubSpotError = CrmError;

async function hs<T>(method: string, path: string, body?: unknown): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) throw new HubSpotError(`HubSpot ${res.status}: ${json.message ?? res.statusText}`, res.status === 429 || res.status >= 500);
    return json;
  } catch (e) {
    if (e instanceof HubSpotError) throw e;
    throw new HubSpotError((e as Error).name === "AbortError" ? "HubSpot timed out after 8s" : `Network error reaching HubSpot: ${(e as Error).message}`, true);
  } finally {
    clearTimeout(timer);
  }
}

const splitName = (n: string | null) => {
  if (!n) return { firstname: undefined, lastname: undefined };
  const [first, ...rest] = n.trim().split(/\s+/);
  return { firstname: first, lastname: rest.join(" ") || undefined };
};

async function upsertContact(e: Enquiry, existingId: string | null): Promise<string> {
  const props: Record<string, string> = { phone: e.phone! };
  const { firstname, lastname } = splitName(e.callerName);
  if (firstname) props.firstname = firstname;
  if (lastname) props.lastname = lastname;
  if (e.location) props.city = e.location.split(",").slice(-1)[0].trim();
  props.hs_lead_status = e.qualificationStatus === "QUALIFIED" ? "OPEN" : e.qualificationStatus === "NOT_QUALIFIED" ? "UNQUALIFIED" : "NEW";

  let id = existingId;
  if (!id) {
    const found = await hs<{ results: { id: string }[] }>("POST", "/crm/v3/objects/contacts/search", {
      filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: e.phone }] }],
      properties: ["phone"],
      limit: 1,
    });
    id = found.results[0]?.id ?? null;
  }
  if (id) {
    await hs("PATCH", `/crm/v3/objects/contacts/${id}`, { properties: props });
    return id;
  }
  const created = await hs<{ id: string }>("POST", "/crm/v3/objects/contacts", { properties: props });
  return created.id;
}

async function addNote(contactId: string, body: string): Promise<string> {
  const note = await hs<{ id: string }>("POST", "/crm/v3/objects/notes", {
    properties: { hs_timestamp: new Date().toISOString(), hs_note_body: body },
    associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: NOTE_TO_CONTACT }] }],
  });
  return note.id;
}

async function createDeal(e: Enquiry, contactId: string): Promise<string> {
  const props: Record<string, string> = {
    dealname: `${e.callerName ?? e.phone} — ${e.propertyType ?? e.projectType ?? "Interiors"}${e.location ? `, ${e.location.split(",")[0]}` : ""}`,
    pipeline: process.env.HUBSPOT_PIPELINE || "default",
    dealstage: process.env.HUBSPOT_DEAL_STAGE || "appointmentscheduled",
    description: `Qualified by the AI front desk. ${e.qualificationReason}${e.pricing.status === "estimated" ? ` Amount = low end of the INTERNAL indicative range (${e.pricing.basis}) — an estimate, not a quote.` : ""}`,
  };
  // Low end of the internal range — a conservative estimate, explicitly labelled in the description.
  if (e.pricing.status === "estimated" && e.indicativePriceMin) props.amount = String(e.indicativePriceMin);
  const deal = await hs<{ id: string }>("POST", "/crm/v3/objects/deals", {
    properties: props,
    associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: DEAL_TO_CONTACT }] }],
  });
  return deal.id;
}

function noteBody(e: Enquiry) {
  return [`<b>Aangan AI front desk — ${e.qualificationStatus.replace("_", " ")}</b>`, e.qualificationReason, `Next step: ${e.recommendedNextAction}`, e.handoff.note ? e.handoff.note.text.replace(/\n/g, "<br>") : ""].filter(Boolean).join("<br>");
}

export const hubspotProvider: CrmProvider = {
  id: "hubspot",
  label: "HubSpot",
  configured: () => Boolean(process.env.HUBSPOT_TOKEN),
  async sync(e, prev, writeNote, out) {
    const contactId = await upsertContact(e, prev.contactId);
    out.contactId = contactId;
    out.recordType = "contact";
    if (writeNote) out.noteIds = [...prev.noteIds, await addNote(contactId, noteBody(e))].slice(-20);
    if (e.qualificationStatus === "QUALIFIED" && !prev.dealId) out.dealId = await createDeal(e, contactId);
  },
};
