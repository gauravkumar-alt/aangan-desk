// Is this enquiry worth a designer's time? Implements Nikhil's rubric (case/qualified.md) with scope from
// case/services.md:
//   • passes all five criteria            → QUALIFIED (forward)
//   • fails any one                        → NOT_QUALIFIED (close gracefully, don't forward)
//   • 1, 2 or 3 still unclear after the call → NEEDS_REVIEW (a person decides — flagged ambiguity)
//   • 4 or 5 unclear                       → treated as qualified, uncertainty noted in the handoff

import { budgetFloor, isSingleRoom, lakh } from "./pricing";
import type { Ruleset } from "./rules/schema";
import type { CallStatus, EnquiryFacts, Pricing, QualificationStatus, RuleCheck } from "./types";

export interface QualifyContext {
  now: Date;
  callStatus: CallStatus;
  afterHours: boolean;
  pricing: Pricing;
  repeatCaller: boolean;
  unknownFields: string[];
  declinedFields: string[];
}

export interface QualifyResult {
  status: QualificationStatus;
  reason: string;
  checks: RuleCheck[];
  flags: string[];
  missingInfo: string[];
  nextAction: string;
  handoffKind: "designer" | "escalation" | null;
  failedCriteria: number;
}

const weeksUntil = (iso: string, now: Date) => (new Date(iso).getTime() - now.getTime()) / (7 * 864e5);

export function qualify(f: EnquiryFacts, rules: Ruleset, ctx: QualifyContext): QualifyResult {
  const q = rules.qualified.rules;
  const svc = rules.services.rules;
  const crit = (id: string) => q?.criteria.find((c) => c.id === id);
  const label = (id: string) => {
    const c = crit(id);
    return c ? `#${c.n} ${c.label}` : id;
  };
  const ev = (id: string) => crit(id)?.evidence ?? [];
  const checks: RuleCheck[] = [];
  const flags: string[] = [];
  const missing: string[] = [];

  if (ctx.callStatus === "missed" || ctx.callStatus === "failed") {
    return { status: "PENDING", reason: "Call did not connect — nothing to assess.", checks: [], flags: [], missingInfo: [], nextAction: "Call the number back now.", handoffKind: null, failedCriteria: 0 };
  }
  if (rules.qualified.state !== "loaded" || !q || !svc) {
    const problem = rules.qualified.problem ?? rules.services.problem ?? "Rules not loaded.";
    return { status: "NEEDS_REVIEW", reason: problem, checks: [{ ruleId: "rules_missing", outcome: "NEEDS_REVIEW", message: problem, evidence: [] }], flags: [], missingInfo: [], nextAction: "Front desk to review manually — qualification rules are not loaded.", handoffKind: null, failedCriteria: 0 };
  }

  // Routing (front-desk practice, T09): an existing client's problem isn't a new enquiry.
  if (f.intent === "existing_client") {
    const r = q.routing.find((x) => x.id === "existing_client");
    checks.push({ ruleId: "existing_client", outcome: "ESCALATE", message: "Existing client with a project issue — not a new enquiry.", evidence: r?.evidence ?? [] });
    return { status: "NEEDS_REVIEW", reason: "Existing client issue — escalated to the studio head.", checks, flags: ["Existing client — escalation"], missingInfo: [], nextAction: r?.action ?? "Escalate to the studio head.", handoffKind: "escalation", failedCriteria: 0 };
  }

  const typeRule = f.projectType ? svc.projectTypes.find((t) => t.id === f.projectType) : null;

  // ── #1 Real project — not just advice (+ services.md scope) ────────────────────────────────
  const c1 = "c1_real_project";
  const notOffered = f.notOffered ? svc.notOffered.find((n) => n.id === f.notOffered) : null;
  if (f.scope === "advisory" || (notOffered && f.notOffered !== "structural") || f.notOffered === "diy_execution") {
    const what = notOffered?.label ?? (f.notOffered === "diy_execution" ? "Caller plans to handle execution themselves" : "Wants advice, not design and execution");
    checks.push({ ruleId: c1, criterion: label(c1), outcome: "NOT_QUALIFIED", message: `${what}. Minimum engagement: ${svc.minimumEngagement.toLowerCase()}.`, evidence: [...ev(c1), ...(notOffered?.evidence ?? [])] });
  } else if (f.exploring) {
    checks.push({ ruleId: c1, criterion: label(c1), outcome: "NOT_QUALIFIED", message: "Only exploring for now — not a project yet.", evidence: ev(c1) });
  } else if (typeRule?.inScope === "no") {
    checks.push({ ruleId: "service_scope", criterion: "Service scope (services.md)", outcome: "NOT_QUALIFIED", message: `${typeRule.label} is out of scope.`, evidence: typeRule.evidence, ambiguity: typeRule.note });
  } else if (typeRule?.inScope === "unclear") {
    checks.push({ ruleId: "service_scope", criterion: "Service scope (services.md)", outcome: "NEEDS_REVIEW", message: `${f.propertyType ?? typeRule.label}: services.md doesn't say whether this is in scope.`, evidence: typeRule.evidence, ambiguity: typeRule.note });
  } else if (!f.projectType && !f.scope && !f.spaces.length) {
    missing.push("what the project is");
    checks.push({ ruleId: c1, criterion: label(c1), outcome: "NEEDS_REVIEW", message: "Not clear what the project is.", evidence: ev(c1) });
  } else {
    checks.push({ ruleId: c1, criterion: label(c1), outcome: "PASS", message: `${typeRule?.label ?? "Home"} — ${f.scope === "full" ? "full scope" : f.spaces.length ? f.spaces.join(", ").toLowerCase() : "design and execution"}.`, evidence: [...ev(c1), ...(typeRule?.evidence ?? [])] });
  }
  if (typeRule?.commercial && f.areaSqFt && typeRule.maxSqFt && f.areaSqFt > typeRule.maxSqFt) {
    checks.push({ ruleId: "commercial_size", criterion: "Service scope (services.md)", outcome: "NEEDS_REVIEW", message: `${f.areaSqFt.toLocaleString("en-IN")} sq ft is above the ~${typeRule.maxSqFt.toLocaleString("en-IN")} sq ft commercial limit.`, evidence: typeRule.evidence, ambiguity: typeRule.maxIsApproximate ? "services.md says “up to approximately”." : undefined });
  }
  if (typeRule?.commercial && f.areaSqFt && f.areaSqFt < 500) {
    checks.push({ ruleId: "commercial_small", criterion: "Service scope (services.md)", outcome: "INFO", message: `Small commercial space (${f.areaSqFt} sq ft).`, evidence: ["Transcript T18"], ambiguity: "services.md sets no minimum size, but the front desk turned down a 180 sq ft pod in September (T18)." });
  }
  if (f.structuralChanges) {
    const s = svc.notOffered.find((n) => n.id === "structural");
    if (f.ownership === "rented")
      checks.push({ ruleId: "rented_structural", criterion: label(c1), outcome: "NEEDS_REVIEW", message: "Rented home, and the caller wants structural changes.", evidence: ["qualified.md › What does NOT disqualify", ...(s?.evidence ?? [])], ambiguity: "qualified.md: a rented home is fine “as long as no structural changes”. It doesn't say whether wanting them disqualifies." });
    else checks.push({ ruleId: "structural", criterion: "Service scope (services.md)", outcome: "INFO", message: "Caller mentioned structural changes — Aangan doesn't do structural work. Scope without it.", evidence: s?.evidence ?? [] });
  }
  if (f.projectType === "residential" && f.scope === "full" && /^1\s*BHK/i.test(f.propertyType ?? "")) {
    checks.push({ ruleId: "scope_edge", criterion: "Service scope (services.md)", outcome: "INFO", message: "1BHK full home — services.md lists full homes as “2BHK onwards”.", evidence: svc.scope.evidence, ambiguity: svc.scope.ambiguity });
  }
  if (f.projectType === "residential" && isSingleRoom(f) && !svc.scope.singleRoomTypes.some((t) => f.spaces[0].toLowerCase().includes(t.split(" ")[0]))) {
    checks.push({ ruleId: "scope_edge", criterion: "Service scope (services.md)", outcome: "INFO", message: `Single room is “${f.spaces[0]}” — services.md names bedroom or living room.`, evidence: svc.scope.evidence, ambiguity: svc.scope.ambiguity });
  }

  // ── #2 In our service area ──────────────────────────────────────────────────────────────────
  const c2 = "c2_service_area";
  const loc = (f.location ?? "").toLowerCase();
  const excluded = svc.serviceArea.excluded.find((x) => loc.includes(x));
  if (!f.location) {
    missing.push("location");
    checks.push({ ruleId: c2, criterion: label(c2), outcome: "NEEDS_REVIEW", message: "Location not captured.", evidence: ev(c2) });
  } else if (excluded || f.locationStatus === "outside") {
    checks.push({ ruleId: c2, criterion: label(c2), outcome: "NOT_QUALIFIED", message: `${f.location} is outside Pune city and PCMC.`, evidence: [...ev(c2), ...svc.serviceArea.evidence] });
  } else if (f.locationStatus === "unrecognised") {
    checks.push({ ruleId: c2, criterion: label(c2), outcome: "NEEDS_REVIEW", message: `Couldn't confirm “${f.location}” is in Pune city or PCMC.`, evidence: svc.serviceArea.evidence, ambiguity: svc.serviceArea.ambiguity });
  } else {
    checks.push({ ruleId: c2, criterion: label(c2), outcome: "PASS", message: `${f.location} is in the service area.`, evidence: svc.serviceArea.evidence });
  }

  // ── #3 Realistic timeline ───────────────────────────────────────────────────────────────────
  const c3 = "c3_timeline";
  const lead = svc.leadTimes;
  const realisticMin = lead.designPhaseWeeks[0] + lead.executionWeeks[0];
  const siteBand = crit(c3)?.siteAvailableWithinWeeks ?? [8, 10];
  const t3: RuleCheck[] = [];
  if (f.timelineDeadline) {
    const w = weeksUntil(f.timelineDeadline, ctx.now);
    const wr = Math.max(0, Math.round(w));
    if (w >= realisticMin) t3.push({ ruleId: c3, criterion: label(c3), outcome: "PASS", message: `Needed in ~${wr} weeks — workable.`, evidence: ev(c3) });
    else if (f.timelineFlexible === true) t3.push({ ruleId: c3, criterion: label(c3), outcome: "PASS", message: `Original deadline was ~${wr} weeks away; caller is open to a later completion.`, evidence: ev(c3) });
    else if (w < lead.minLeadWeeks) t3.push({ ruleId: c3, criterion: label(c3), outcome: "NOT_QUALIFIED", message: `Needs it ready in ~${wr} weeks — under the ${lead.minLeadWeeks}-week minimum lead time.`, evidence: [...ev(c3), ...lead.evidence] });
    else
      t3.push({
        ruleId: c3,
        criterion: label(c3),
        outcome: "NEEDS_REVIEW",
        message: `Needs it ready in ~${wr} weeks — above the ${lead.minLeadWeeks}-week minimum but under design + execution (~${realisticMin} weeks).`,
        evidence: [...ev(c3), ...lead.evidence],
        ambiguity: "services.md's minimum lead time and its design/execution durations point different ways for this deadline.",
      });
  }
  if (f.siteAvailableDate) {
    const w = weeksUntil(f.siteAvailableDate, ctx.now);
    const wr = Math.max(0, Math.round(w));
    if (w > siteBand[1]) t3.push({ ruleId: c3, criterion: label(c3), outcome: "NOT_QUALIFIED", message: `Site isn't available for ~${wr} weeks — the rubric needs it within ${siteBand.join("–")} weeks.`, evidence: ev(c3) });
    else if (w > siteBand[0]) t3.push({ ruleId: c3, criterion: label(c3), outcome: "NEEDS_REVIEW", message: `Site available in ~${wr} weeks — inside the rubric's ${siteBand.join("–")} week band.`, evidence: ev(c3), ambiguity: `“Within ${siteBand.join("–")} weeks” doesn't say which end applies.` });
    else t3.push({ ruleId: c3, criterion: label(c3), outcome: "PASS", message: `Site available in ~${wr} weeks.`, evidence: ev(c3) });
  }
  if (!t3.length) {
    if (f.timeline) t3.push({ ruleId: c3, criterion: label(c3), outcome: "PASS", message: `Timeline: ${f.timeline}.`, evidence: ev(c3) });
    else {
      missing.push("timeline");
      t3.push({ ruleId: c3, criterion: label(c3), outcome: "NEEDS_REVIEW", message: ctx.unknownFields.includes("timeline") ? "Caller wasn't sure of the timeline." : "Timeline not captured.", evidence: ev(c3) });
    }
  }
  checks.push(...t3);

  // ── #4 Right budget band (broadly) — never probed; only a volunteered number counts ─────────
  const c4 = "c4_budget";
  if (f.budgetMaxInr) {
    const floor = budgetFloor(f, rules);
    if (floor && f.budgetMaxInr < floor.floorInr)
      checks.push({ ruleId: c4, criterion: label(c4), outcome: "NOT_QUALIFIED", message: `Volunteered budget (${f.budget}) is clearly below what this scope costs (at least ~${lakh(floor.floorInr)}, ${floor.basis}).`, evidence: [...ev(c4), "pricing.md"] });
    else checks.push({ ruleId: c4, criterion: label(c4), outcome: "PASS", message: floor ? `Budget volunteered: ${f.budget}.` : `Budget volunteered: ${f.budget} (scope too vague to compare).`, evidence: ev(c4) });
  } else {
    checks.push({ ruleId: c4, criterion: label(c4), outcome: "PASS", message: ctx.declinedFields.includes("budget") ? "Caller preferred not to discuss budget — treated as qualified." : "Budget not mentioned — treated as qualified (not probed).", evidence: ev(c4) });
  }

  // ── #5 Decision-maker on the call (or represented) ─────────────────────────────────────────
  const c5 = "c5_decision_maker";
  if (f.decisionMaker === "no") checks.push({ ruleId: c5, criterion: label(c5), outcome: "NOT_QUALIFIED", message: "Caller is researching for someone else and isn't authorised to move forward.", evidence: ev(c5) });
  else if (f.decisionMaker === "yes" || f.decisionMaker === "authorised") checks.push({ ruleId: c5, criterion: label(c5), outcome: "PASS", message: f.decisionMaker === "yes" ? "Caller is a decision-maker." : "Caller is authorised to move forward.", evidence: ev(c5) });
  else
    checks.push({
      ruleId: c5,
      criterion: label(c5),
      outcome: "INFO",
      message: f.decisionMaker === "family_attending" ? "Calling for family, who will attend the consultation. Authority not confirmed." : "Decision-maker not confirmed.",
      evidence: ev(c5),
      ambiguity: "Unclear on #5: don't push — treat as qualified and note it (qualified.md › At the boundary).",
    });

  // ── handoff flags (front-desk practice from the transcripts) ───────────────────────────────
  for (const hf of q.handoffFlags) {
    if (hf.id === "referral" && f.referral && !/^Found us on/.test(f.referral)) flags.push(hf.label);
    if (hf.id === "repeat_caller" && ctx.repeatCaller) flags.push(hf.label);
    if (hf.id === "large_project" && f.projectType === "residential" && f.areaSqFt && f.areaSqFt >= (hf.minSqFt ?? Infinity)) flags.push(hf.label);
  }
  if (ctx.afterHours) flags.push("After hours");

  // ── decide ─────────────────────────────────────────────────────────────────────────────────
  const failed = checks.filter((c) => c.outcome === "NOT_QUALIFIED");
  const review = checks.filter((c) => c.outcome === "NEEDS_REVIEW");
  const failedCriteria = new Set(failed.map((c) => c.criterion ?? c.ruleId)).size;
  let status: QualificationStatus;
  let reason: string;
  let nextAction: string;
  if (failed.length) {
    status = "NOT_QUALIFIED";
    reason = failed.map((c) => c.message).join(" ");
    nextAction = failed.some((c) => c.message.startsWith("Only exploring")) ? "Not forwarded. Caller invited to call back when they're ready." : "Not forwarded — closed gracefully on the call.";
  } else if (review.length) {
    status = "NEEDS_REVIEW";
    reason = review.map((c) => c.message).join(" ");
    nextAction = `Front desk to check: ${review.map((c) => c.message.replace(/\.$/, "")).join("; ")}. Then forward to a designer or close.`;
  } else {
    status = "QUALIFIED";
    const bits = [f.propertyType ?? typeRule?.label, f.location, f.areaSqFt ? `${f.areaSqFt.toLocaleString("en-IN")} sq ft` : null, f.scope === "full" ? "full scope" : f.spaces.length ? f.spaces.join(", ") : null, f.timeline].filter(Boolean).join(" · ");
    reason = `Passes all five criteria: ${bits}.`;
    nextAction = ctx.afterHours
      ? "Designer to call back when the studio opens at 10am to book the consultation (caller has been told)."
      : "Designer to call back within the hour to book the consultation (enquiries answered within an hour convert 4× better).";
    if (flags.some((x) => /principal designer/.test(x))) nextAction += " Consider a principal designer site visit.";
  }
  return { status, reason, checks, flags, missingInfo: missing, nextAction, handoffKind: status === "QUALIFIED" ? "designer" : null, failedCriteria };
}
