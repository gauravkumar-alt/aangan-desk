import { z } from "zod";

// case/*.md = the studio's supplied file, verbatim, followed by a ```json aangan-rules block that maps
// it into something the system can run. The prose stays the source of truth; the block cites it.

const evidence = z.array(z.string()).default([]);

export const ServicesRules = z.object({
  file: z.literal("services"),
  status: z.string(),
  source: z.string().optional(),
  serviceArea: z.object({
    regions: z.array(z.string()),
    named: z.array(z.string()).default([]),
    includesAdjoining: z.boolean().default(false),
    excluded: z.array(z.string()).default([]),
    excludeOtherCities: z.boolean().default(true),
    evidence,
    ambiguity: z.string().optional(),
  }),
  projectTypes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      inScope: z.enum(["yes", "no", "unclear"]),
      commercial: z.boolean().optional(),
      minSqFt: z.number().optional(),
      maxSqFt: z.number().optional(),
      maxIsApproximate: z.boolean().optional(),
      note: z.string().optional(),
      evidence,
    }),
  ),
  notOffered: z.array(z.object({ id: z.string(), label: z.string(), evidence })),
  minimumEngagement: z.string(),
  scope: z.object({
    fullHomeFrom: z.string(),
    partialHome: z.string(),
    singleRoomTypes: z.array(z.string()),
    evidence,
    ambiguity: z.string().optional(),
  }),
  leadTimes: z.object({
    designPhaseWeeks: z.tuple([z.number(), z.number()]),
    executionWeeks: z.tuple([z.number(), z.number()]),
    minLeadWeeks: z.number(),
    evidence,
  }),
  hours: z.object({
    open: z.string(),
    close: z.string(),
    days: z.array(z.number()),
    timezone: z.string(),
    evidence,
    ambiguity: z.string().optional(),
  }),
});

export const QualifiedRules = z.object({
  file: z.literal("qualified"),
  status: z.string(),
  source: z.string().optional(),
  criteria: z.array(
    z.object({
      id: z.string(),
      n: z.number(),
      label: z.string(),
      ifUnclear: z.enum(["ask", "qualify_and_note"]),
      question: z.string().optional(),
      neverAsk: z.boolean().optional(),
      siteAvailableWithinWeeks: z.tuple([z.number(), z.number()]).optional(),
      evidence,
    }),
  ),
  onSingleFail: z.string(),
  twoOrMoreFailLine: z.string(),
  unresolvedAfterQuestion: z.object({ outcome: z.literal("NEEDS_REVIEW"), ambiguity: z.string() }),
  doesNotDisqualify: z.array(z.string()),
  routing: z.array(z.object({ id: z.string(), label: z.string(), action: z.string(), evidence, note: z.string().optional() })),
  handoffFlags: z.array(z.object({ id: z.string(), label: z.string(), minSqFt: z.number().optional(), evidence })),
});

const Tier = z.object({ id: z.string(), label: z.string(), minPerSqFt: z.number().positive(), maxPerSqFt: z.number().positive().nullable() });

export const PricingRules = z.object({
  file: z.literal("pricing"),
  status: z.string(),
  source: z.string().optional(),
  agentMayQuote: z.boolean(),
  approvedResponse: z.string(),
  disclaimer: z.string(),
  basis: z.string(),
  residential: z.object({ tiers: z.array(Tier), singleRoom: z.object({ minInr: z.number(), maxInr: z.number() }) }),
  commercial: z.object({ appliesTo: z.array(z.string()), tiers: z.array(Tier) }),
  defaultTier: z.object({ residential: z.string(), commercial: z.string(), ambiguity: z.string().optional() }),
  partialScope: z.object({ rule: z.string(), ambiguity: z.string().optional() }),
  conflict: z.string().optional(),
});

export type ServicesRules = z.infer<typeof ServicesRules>;
export type QualifiedRules = z.infer<typeof QualifiedRules>;
export type PricingRules = z.infer<typeof PricingRules>;

export interface RuleFileState<T> {
  name: "services.md" | "qualified.md" | "pricing.md";
  state: "loaded" | "missing" | "no_rules_block" | "invalid";
  status: string | null; // "approved" once it's the studio's own file
  rules: T | null;
  problem: string | null;
  prose: string; // the supplied text, without the rules block
}

export interface Ruleset {
  services: RuleFileState<ServicesRules>;
  qualified: RuleFileState<QualifiedRules>;
  pricing: RuleFileState<PricingRules>;
  loadedAt: string;
}

/** Problems that should block trust in the system (shown as a banner). */
export function ruleWarnings(r: Ruleset): string[] {
  const out: string[] = [];
  for (const f of [r.services, r.qualified, r.pricing]) {
    if (f.state !== "loaded") out.push(`${f.name}: ${f.problem}`);
    else if (f.status !== "approved") out.push(`${f.name} is marked “${f.status}”, not the studio's approved file.`);
  }
  return out;
}

export interface Ambiguity {
  file: string;
  topic: string;
  text: string;
}

/** Every open question the rules files leave, for the Rules view. */
export function ruleAmbiguities(r: Ruleset): Ambiguity[] {
  const out: Ambiguity[] = [];
  const s = r.services.rules;
  const q = r.qualified.rules;
  const p = r.pricing.rules;
  if (p?.conflict) out.push({ file: "pricing.md", topic: "Quoting prices to callers", text: p.conflict });
  if (s?.serviceArea.ambiguity) out.push({ file: "services.md", topic: "Service area boundary", text: s.serviceArea.ambiguity });
  if (s?.scope.ambiguity) out.push({ file: "services.md", topic: "Scope edge cases", text: s.scope.ambiguity });
  for (const t of s?.projectTypes ?? []) if (t.inScope === "unclear" || t.note) out.push({ file: "services.md", topic: t.label, text: t.note ?? "Scope unclear." });
  if (s?.hours.ambiguity) out.push({ file: "services.md", topic: "Front desk hours", text: s.hours.ambiguity });
  if (s) {
    out.push({
      file: "services.md + qualified.md",
      topic: "Timeline thresholds",
      text: `services.md sets a hard minimum of ${s.leadTimes.minLeadWeeks} weeks. But design (${s.leadTimes.designPhaseWeeks.join("–")} weeks) plus execution (${s.leadTimes.executionWeeks.join("–")} weeks) means about ${s.leadTimes.designPhaseWeeks[0] + s.leadTimes.executionWeeks[0]} weeks at the earliest. Deadlines in between go to a person. qualified.md also asks for the site to be available within ${q?.criteria.find((c) => c.siteAvailableWithinWeeks)?.siteAvailableWithinWeeks?.join("–") ?? "8–10"} weeks; the band between the two numbers goes to a person.`,
    });
  }
  if (q) out.push({ file: "qualified.md", topic: "Still unclear after asking", text: q.unresolvedAfterQuestion.ambiguity });
  if (p?.defaultTier.ambiguity) out.push({ file: "pricing.md", topic: "Specification tier", text: p.defaultTier.ambiguity });
  if (p?.partialScope.ambiguity) out.push({ file: "pricing.md", topic: "Partial-home pricing", text: p.partialScope.ambiguity });
  if (p) {
    out.push({
      file: "qualified.md + pricing.md",
      topic: "“Clearly below” a budget",
      text: `qualified.md doesn't define the threshold. The system uses the lowest figure pricing.md allows for the described scope: single room ₹${(p.residential.singleRoom.minInr / 1e5).toFixed(1)}L, homes ₹${p.residential.tiers[0].minPerSqFt.toLocaleString("en-IN")}/sq ft, commercial ₹${p.commercial.tiers[0].minPerSqFt.toLocaleString("en-IN")}/sq ft. Only budgets below that are treated as misaligned.`,
    });
    out.push({ file: "pricing.md", topic: "“I can book that for you”", text: "Designer scheduling is out of scope for this build. When a caller says yes, the designer calls back to fix the consultation slot." });
  }
  return out;
}
