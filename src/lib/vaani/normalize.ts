// Vaani call → enquiry facts. Two sources, merged:
//  1. collectedData — the structured fields the Vaani agent is configured to extract (free-form object;
//     keys per vaani/collected-data-fields.json, with aliases because configs drift).
//  2. the transcript — re-read caller turns with the same extractor, to fill anything collectedData missed.
// collectedData wins where both have a value. Nothing is invented: absent → null.

import { extract, parseArea, parseBudget, parseTimeline, type Slot } from "../extract";
import { mergeFacts } from "../facts";
import { findLocalities } from "../localities";
import type { Correction, EnquiryFacts, TranscriptTurn } from "../types";
import { EMPTY_FACTS } from "../types";

const ALIASES: Record<string, string[]> = {
  callerName: ["caller_name", "callerName", "name", "customer_name", "full_name", "caller"],
  intent: ["intent", "call_intent"],
  projectType: ["project_type", "projectType", "space_type"],
  propertyType: ["property_type", "propertyType", "property"],
  location: ["location", "locality", "area_name", "address", "city", "project_location"],
  areaSqFt: ["area_sqft", "areaSqFt", "carpet_area", "carpet_area_sqft", "square_feet", "sqft", "size", "area"],
  spaces: ["spaces", "rooms", "scope_rooms", "rooms_or_whole_home", "rooms_or_scope"],
  scope: ["scope", "project_scope"],
  projectStage: ["project_stage", "projectStage", "stage", "property_state"],
  ownership: ["ownership", "owner_or_rented", "own_or_rent", "ownership_status"],
  decisionMaker: ["decision_maker", "decisionMaker"],
  structuralChanges: ["structural_changes", "structuralChanges"],
  timeline: ["timeline", "deadline", "when", "project_due_date", "completion_date", "completion_timeline", "due_date"],
  timelineFlexible: ["later_start_ok", "timeline_flexible"],
  budget: ["budget"],
  exploring: ["exploring", "just_exploring"],
  referral: ["referral", "source", "how_found"],
  callbackPreference: ["callback_time", "preferred_callback_time", "best_time_to_call", "callback_preference"],
  requirements: ["requirements", "design_requirements", "style"],
  constraints: ["constraints", "notes_constraints"],
};

const UNKNOWNISH = /^(unknown|n\/?a|na|none|not (provided|given|known|sure|mentioned)|don'?t know|no idea|-|null|undefined)$/i;
const DECLINEDISH = /^(declined|refused|prefer(s|red)? not( to say)?|not disclosed|won'?t say)$/i;

function get(cd: Record<string, unknown>, field: string): unknown {
  for (const k of ALIASES[field] ?? [field]) if (k in cd) return cd[k];
  return undefined;
}

const asBool = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (/^(true|yes|y|1)$/i.test(v.trim())) return true;
    if (/^(false|no|n|0)$/i.test(v.trim())) return false;
  }
  return null;
};

export function factsFromCollectedData(cd: Record<string, unknown>, now: Date) {
  const facts: Partial<EnquiryFacts> = {};
  const unknown: string[] = Array.isArray(cd.unknown_fields) ? (cd.unknown_fields as string[]).map(String) : [];
  const declined: string[] = Array.isArray(cd.declined_fields) ? (cd.declined_fields as string[]).map(String) : [];

  for (const field of Object.keys(ALIASES)) {
    const raw = get(cd, field);
    if (raw === undefined || raw === null) continue;
    if (typeof raw === "string") {
      const v = raw.trim();
      if (!v) continue;
      if (DECLINEDISH.test(v)) {
        if (!declined.includes(field)) declined.push(field);
        continue;
      }
      if (UNKNOWNISH.test(v)) {
        if (!unknown.includes(field)) unknown.push(field);
        continue;
      }
    }
    const str = Array.isArray(raw) ? raw.join(", ") : String(raw);
    switch (field) {
      case "areaSqFt": {
        const a = typeof raw === "number" ? { area: raw, range: null } : parseArea(str, true);
        if (a) Object.assign(facts, { areaSqFt: a.area, areaSqFtRange: a.range });
        break;
      }
      case "budget": {
        const b = parseBudget(str);
        facts.budget = b?.text ?? str;
        if (b) Object.assign(facts, { budgetMinInr: b.min, budgetMaxInr: b.max });
        break;
      }
      case "timeline": {
        const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str.trim());
        if (iso) {
          // "2026-11-30" → a real deadline the timeline rule can check
          const d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
          facts.timeline = `Done by ${d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`;
          facts.timelineDeadline = d.toISOString().slice(0, 10);
          break;
        }
        const t = parseTimeline(str, now);
        facts.timeline = t?.timeline ?? str;
        if (t?.timelineDeadline) facts.timelineDeadline = t.timelineDeadline;
        if (t?.timelineFlexible != null) facts.timelineFlexible = t.timelineFlexible;
        if (typeof cd.timeline_deadline === "string" && /^\d{4}-\d{2}-\d{2}/.test(cd.timeline_deadline)) facts.timelineDeadline = cd.timeline_deadline.slice(0, 10);
        break;
      }
      case "location": {
        const hit = findLocalities(str)[0];
        if (hit && (hit.region === "Pune" || hit.region === "PCMC")) {
          facts.location = hit.name === "Pune" || hit.name === "PCMC" ? str : `${hit.name}, ${hit.region === "PCMC" ? "PCMC" : "Pune"}`;
          facts.locationStatus = "in_area";
        } else if (hit?.region === "outside") Object.assign(facts, { location: hit.name, locationStatus: "outside" });
        else Object.assign(facts, { location: str, locationStatus: "unrecognised" });
        break;
      }
      case "spaces": {
        // Agents often return prose ("whole home", "kitchen and two bedrooms") — read it like speech.
        const x = extract(str, { lastAsked: "spaces", now });
        if (x.facts.spaces?.length) facts.spaces = x.facts.spaces;
        else if (Array.isArray(raw)) facts.spaces = raw.map(String);
        if (x.facts.scope) facts.scope = x.facts.scope;
        break;
      }
      case "projectType": {
        const v = str.toLowerCase();
        const map: Record<string, EnquiryFacts["projectType"]> = { residential: "residential", home: "residential", office: "office", commercial_office: "office", hospitality: "hospitality", restaurant: "hospitality", fitness: "fitness", gym: "fitness", other_commercial: "other_commercial", retail: "other_commercial" };
        facts.projectType = map[v] ?? extract(str, { lastAsked: "projectType", now }).facts.projectType ?? null;
        break;
      }
      case "scope":
        if (["full", "partial", "advisory"].includes(str)) facts.scope = str as EnquiryFacts["scope"];
        break;
      case "ownership":
        if (["owner", "rented", "family"].includes(str)) facts.ownership = str as EnquiryFacts["ownership"];
        else facts.ownership = extract(str, { lastAsked: "ownership", now }).facts.ownership ?? null;
        break;
      case "decisionMaker":
        if (["yes", "no", "family_attending"].includes(str)) facts.decisionMaker = str as EnquiryFacts["decisionMaker"];
        else if (asBool(raw) != null) facts.decisionMaker = asBool(raw) ? "yes" : "no";
        break;
      case "intent":
        if (["new_project", "existing_client", "other"].includes(str)) facts.intent = str as EnquiryFacts["intent"];
        break;
      case "structuralChanges":
      case "timelineFlexible":
      case "exploring": {
        const b = asBool(raw);
        if (b != null) (facts as Record<string, unknown>)[field] = b;
        break;
      }
      default:
        (facts as Record<string, unknown>)[field] = str;
    }
  }
  // Any field we don't map by name (agent-generated names drift): read its text for facts we still lack.
  const known = new Set(Object.values(ALIASES).flat().concat(["callback_number", "caller_phone", "phone", "unknown_fields", "declined_fields", "location_status", "timeline_deadline", "call_ended_early", "repeat_caller", "alternate_phone", "cost_inr"]));
  for (const [k, v] of Object.entries(cd)) {
    if (known.has(k) || v == null || typeof v === "object" || UNKNOWNISH.test(String(v).trim())) continue;
    const x = extract(String(v), { lastAsked: null, now }).facts;
    for (const [fk, fv] of Object.entries(x) as [keyof EnquiryFacts, unknown][]) {
      const cur = (facts as Record<string, unknown>)[fk];
      if (fv != null && (cur == null || (Array.isArray(cur) && !cur.length))) (facts as Record<string, unknown>)[fk] = fv;
    }
  }
  if (facts.location && typeof cd.location_status === "string" && ["in_area", "outside"].includes(cd.location_status)) facts.locationStatus = cd.location_status as EnquiryFacts["locationStatus"];
  if (facts.spaces?.length && !facts.scope) facts.scope = extract(facts.spaces.join(", "), { lastAsked: "spaces", now }).facts.scope ?? null;
  if (facts.propertyType && !facts.projectType) facts.projectType = extract(facts.propertyType, { lastAsked: "projectType", now }).facts.projectType ?? null;
  return { facts, unknown, declined };
}

/** Which slot was the agent asking about? Lets "about 1,200" or "not sure" attach to the right field. */
export function slotFromAgentText(text: string): Slot {
  const t = text.toLowerCase();
  if (/name|who i'?m speaking/.test(t)) return "callerName";
  if (/square feet|sq ?ft|how big|carpet area|size/.test(t)) return "areaSqFt";
  if (/which part|where is|where's|location|locality/.test(t)) return "location";
  if (/budget/.test(t)) return "budget";
  if (/landlord/.test(t)) return "landlord";
  if (/your own home|are you renting|are you the owner|own it or rent/.test(t)) return "ownership";
  if (/later (start|completion|date)|slightly later|later finish/.test(t)) return "laterStart";
  if (/decision|come to the consultation/.test(t)) return "decisionMaker";
  if (/when|timeline|operational/.test(t)) return "timeline";
  if (/whole home|particular rooms|workstations|what do you need/.test(t)) return "spaces";
  if (/home or an office|what kind of space/.test(t)) return "projectType";
  if (/state of the space|bare shell/.test(t)) return "projectStage";
  if (/design and execution|full project/.test(t)) return "fullService";
  return null;
}

export function factsFromTranscript(turns: TranscriptTurn[], now: Date) {
  let facts: EnquiryFacts = { ...EMPTY_FACTS, spaces: [] };
  const corrections: Correction[] = [];
  const unknown: string[] = [];
  const declined: string[] = [];
  let lastAsked: Slot = null;
  let repeatCaller = false;
  for (const turn of turns) {
    if (turn.role.toUpperCase() === "AGENT") {
      lastAsked = slotFromAgentText(turn.text);
      continue;
    }
    const ext = extract(turn.text, { lastAsked, now });
    const m = mergeFacts(facts, ext.facts, now.toISOString());
    facts = m.facts;
    corrections.push(...m.corrections);
    for (const u of ext.unknown) if (!unknown.includes(u)) unknown.push(u);
    for (const d of ext.declined) if (!declined.includes(d)) declined.push(d);
    if (ext.mentionsPriorContact) repeatCaller = true;
  }
  return { facts, corrections, unknown, declined, repeatCaller };
}

/** collectedData first, transcript fills the gaps. */
export function normalizeCall(cd: Record<string, unknown> | null | undefined, transcript: TranscriptTurn[], now: Date) {
  const fromT = factsFromTranscript(transcript, now);
  const fromCd = cd ? factsFromCollectedData(cd, now) : { facts: {}, unknown: [], declined: [] };
  const merged = mergeFacts(fromT.facts, fromCd.facts, now.toISOString(), { track: false });
  const unknown = [...new Set([...fromCd.unknown, ...fromT.unknown])].filter((k) => (merged.facts as unknown as Record<string, unknown>)[k] == null);
  const declined = [...new Set([...fromCd.declined, ...fromT.declined])].filter((k) => (merged.facts as unknown as Record<string, unknown>)[k] == null);
  const repeat = fromT.repeatCaller || asBool(cd?.repeat_caller) === true;
  return { facts: merged.facts, corrections: fromT.corrections, unknown, declined, repeatCaller: repeat };
}
