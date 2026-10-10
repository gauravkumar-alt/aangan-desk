import type { Correction, EnquiryFacts } from "./types";

// Fields where a new, different value means the caller changed their answer.
const CORRECTABLE: (keyof EnquiryFacts)[] = ["callerName", "location", "areaSqFt", "timeline", "budget", "projectType"];
const isStart = (t: unknown) => typeof t === "string" && /^start/i.test(t);

const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v));

/**
 * Merge newly heard facts into what we already know. Latest answer wins (callers correct themselves),
 * and every overwrite of a correctable field is recorded so the designer can see it.
 */
export function mergeFacts(base: EnquiryFacts, incoming: Partial<EnquiryFacts>, at: string, opts: { track?: boolean } = {}) {
  const next: EnquiryFacts = { ...base };
  const corrections: Correction[] = [];
  for (const [k, v] of Object.entries(incoming) as [keyof EnquiryFacts, unknown][]) {
    if (k === "timelineDeadline" && v === null && "timeline" in incoming) {
      next.timelineDeadline = null; // an explicit "no deadline any more"
      continue;
    }
    if (v === undefined || v === null || (Array.isArray(v) && !v.length) || v === "") continue;
    const prev = base[k];
    if (k === "spaces") {
      // Spaces accumulate ("kitchen… oh, and the study too"), de-duplicated.
      const merged = [...base.spaces];
      for (const s of v as string[]) if (!merged.includes(s)) merged.push(s);
      next.spaces = merged;
      continue;
    }
    if (k === "timeline" && prev && isStart(prev) !== isStart(v) && !("timelineDeadline" in incoming && incoming.timelineDeadline === null)) {
      // "Start now" + "done by March" are two halves of one answer, not a change of mind.
      next.timeline = isStart(v) ? `${v} · ${prev}` : `${prev} · ${v}`;
      if (isStart(v)) next.timelineDeadline = base.timelineDeadline;
      continue;
    }
    if (opts.track !== false && CORRECTABLE.includes(k) && prev != null && show(prev) !== show(v)) {
      // A location refinement ("Pune" → "Kothrud, Pune") isn't a correction.
      const refinement = k === "location" && /^(pune|pcmc)$/i.test(show(prev));
      if (!refinement) corrections.push({ field: k, from: show(prev), to: show(v), at });
    }
    (next as unknown as Record<string, unknown>)[k] = v;
  }
  finalize(next);
  // If the deadline changed and no new range was given, drop the stale range.
  if (incoming.areaSqFt && !incoming.areaSqFtRange) next.areaSqFtRange = null;
  if (incoming.timeline && !("timelineDeadline" in incoming) && !(base.timeline && isStart(base.timeline) !== isStart(incoming.timeline))) next.timelineDeadline = null;
  return { facts: next, corrections };
}

/** Inferences that need facts from more than one sentence. */
function finalize(f: EnquiryFacts) {
  // A bare-shell office is a full fit-out by definition (T06: "Bare shell" → "Full fitout from scratch").
  if (f.projectType === "office" && f.projectStage && /bare shell/i.test(f.projectStage) && f.scope !== "advisory") f.scope = "full";
  // "my living room and bedroom" → it's a home, even if the caller never said "flat".
  if (!f.projectType && f.spaces.some((x) => /living room|bedroom|wardrobe|pooja/i.test(x))) f.projectType = "residential";
}

/** snake_case keys the Vaani agent is configured to collect (see vaani/collected-data-fields.json). */
export function factsToCollectedData(f: EnquiryFacts, unknown: string[], declined: string[], extra: Record<string, unknown> = {}) {
  return {
    caller_name: f.callerName,
    intent: f.intent,
    project_type: f.projectType,
    property_type: f.propertyType,
    location: f.location,
    location_status: f.locationStatus, // "in_area" after the caller confirmed an unfamiliar locality
    area_sqft: f.areaSqFtRange ? `${f.areaSqFtRange[0]}-${f.areaSqFtRange[1]}` : f.areaSqFt,
    spaces: f.spaces,
    scope: f.scope,
    project_stage: f.projectStage,
    ownership: f.ownership,
    decision_maker: f.decisionMaker,
    structural_changes: f.structuralChanges,
    timeline: f.timeline,
    timeline_deadline: f.timelineDeadline,
    later_start_ok: f.timelineFlexible,
    budget: f.budget,
    exploring: f.exploring,
    referral: f.referral,
    callback_time: f.callbackPreference,
    requirements: f.requirements,
    constraints: f.constraints,
    unknown_fields: unknown,
    declined_fields: declined,
    ...extra,
  };
}
