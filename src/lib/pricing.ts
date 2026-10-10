import type { EnquiryFacts, Pricing } from "./types";
import type { PricingRules, Ruleset } from "./rules/schema";

// Indicative pricing from case/pricing.md. pricing.md is an INTERNAL guide: "No number from this guide
// should be quoted to a client." So these ranges go to the designer's handoff note and the dashboard's
// pipeline estimate only. What the voice agent says about price is `callerPriceResponse()`.

const DEFAULT_DISCLAIMER = "Indicative only — internal. Varies by site, materials and complexity; confirmed by the designer at the consultation.";

export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
export const lakh = (n: number) => (n >= 1e7 ? `₹${+(n / 1e7).toFixed(2)} Cr` : `₹${+(n / 1e5).toFixed(1)}L`);
export const lakhRange = (a: number, b: number | null) => (b == null ? `${lakh(a)}+` : `${lakh(a)}–${lakh(b).replace("₹", "")}`);

// Round outward to the nearest ₹10,000 so we never imply false precision.
const down = (n: number) => Math.floor(n / 1e4) * 1e4;
const up = (n: number) => Math.ceil(n / 1e4) * 1e4;

const COMMERCIAL = (p: PricingRules, type: string | null) => Boolean(type && p.commercial.appliesTo.includes(type));
export const isSingleRoom = (f: EnquiryFacts) => f.scope === "partial" && f.spaces.filter((s) => !/wardrobe|flooring|lighting/i.test(s)).length === 1;

export function indicativePrice(f: EnquiryFacts, rules: Ruleset): Pricing {
  const file = rules.pricing;
  const none = { minInr: null, maxInr: null, rateId: null, alternatives: [], source: "none" as const, internalOnly: true };
  if (file.state !== "loaded" || !file.rules) return { ...none, status: "rules_missing", basis: file.problem ?? "pricing.md not loaded", disclaimer: DEFAULT_DISCLAIMER };
  const p = file.rules;
  const disclaimer = p.disclaimer || DEFAULT_DISCLAIMER;
  const source = p.status === "approved" ? ("approved" as const) : ("placeholder" as const);
  const internalOnly = !p.agentMayQuote;
  const base = { ...none, internalOnly, disclaimer };

  if (!f.projectType) return { ...base, status: "insufficient_info", basis: "Project type not known." };
  const typeRule = rules.services.rules?.projectTypes.find((t) => t.id === f.projectType);
  if (typeRule && typeRule.inScope === "no") return { ...base, status: "not_applicable", basis: `${typeRule.label}: not work Aangan takes on.` };
  if (f.scope === "advisory" || f.notOffered) return { ...base, status: "not_applicable", basis: "Not a design-and-execution project — nothing to price." };

  // Single room has its own all-in band in pricing.md.
  if (f.projectType === "residential" && isSingleRoom(f)) {
    const r = p.residential.singleRoom;
    return { ...base, status: "estimated", source, minInr: r.minInr, maxInr: r.maxInr, rateId: "single_room", basis: `Single room redesign, all-in (${f.spaces[0]})` };
  }
  if (f.scope === "partial") return { ...base, status: "designer_quote", basis: "Partial home (selected rooms): pricing.md has no per-room rate, and the caller's area is for the whole flat. The designer quotes." };
  if (!f.areaSqFt) return { ...base, status: "insufficient_info", basis: "Carpet area not known — no estimate." };

  const commercial = COMMERCIAL(p, f.projectType);
  if (f.projectType !== "residential" && !commercial) return { ...base, status: "insufficient_info", basis: `pricing.md has no rate for ${f.projectType}.` };
  const tiers = commercial ? p.commercial.tiers : p.residential.tiers;
  const wanted = f.specTier && !commercial ? f.specTier : f.specTier === "premium" && commercial ? "premium" : commercial ? p.defaultTier.commercial : p.defaultTier.residential;
  const tier = tiers.find((t) => t.id === wanted) ?? tiers[0];
  const [lo, hi] = f.areaSqFtRange ?? [f.areaSqFt, f.areaSqFt];
  const range = (t: (typeof tiers)[number]) => ({ min: down(lo * t.minPerSqFt), max: t.maxPerSqFt == null ? null : up(hi * t.maxPerSqFt) });
  const main = range(tier);
  const areaText = f.areaSqFtRange ? `${lo.toLocaleString("en-IN")}–${hi.toLocaleString("en-IN")} sq ft` : `${lo.toLocaleString("en-IN")} sq ft`;
  const rateText = tier.maxPerSqFt == null ? `${inr(tier.minPerSqFt)}+/sq ft` : `${inr(tier.minPerSqFt)}–${inr(tier.maxPerSqFt).replace("₹", "")}/sq ft`;
  return {
    ...base,
    status: "estimated",
    source,
    minInr: main.min,
    maxInr: main.max,
    rateId: tier.id,
    basis: `${areaText} × ${rateText} (${tier.label}${f.specTier ? ", as the caller described" : ", default tier — specification not discussed"})`,
    alternatives: tiers.filter((t) => t.id !== tier.id).map((t) => ({ label: t.label, minInr: range(t).min, maxInr: range(t).max })),
  };
}

/** The lowest cost pricing.md allows for what was described: the line for a "clearly below" budget (qualified.md › 4). */
export function budgetFloor(f: EnquiryFacts, rules: Ruleset): { floorInr: number; basis: string } | null {
  const p = rules.pricing.rules;
  if (!p || !f.projectType) return null;
  if (f.projectType === "residential") {
    if (f.scope === "full" && f.areaSqFt) return { floorInr: f.areaSqFt * p.residential.tiers[0].minPerSqFt, basis: `${f.areaSqFt} sq ft × lowest residential rate` };
    // Any room redesign with execution costs at least the single-room minimum.
    if (f.scope || f.spaces.length) return { floorInr: p.residential.singleRoom.minInr, basis: "single-room minimum" };
    return null;
  }
  if (COMMERCIAL(p, f.projectType) && f.areaSqFt) return { floorInr: f.areaSqFt * p.commercial.tiers[0].minPerSqFt, basis: `${f.areaSqFt} sq ft × lowest commercial rate` };
  return null;
}

/** What the voice agent says when asked about price. pricing.md decides; numbers only if it allows them. */
export function callerPriceResponse(pr: Pricing, rules: Ruleset): string {
  const p = rules.pricing.rules;
  if (!p || !p.agentMayQuote || pr.status !== "estimated" || pr.minInr == null) {
    return p?.approvedResponse ?? "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it at the consultation.";
  }
  const say = (n: number) => (n >= 1e7 ? `${+(n / 1e7).toFixed(1)} crore` : `${+(n / 1e5).toFixed(1)} lakh`);
  return `Based on what you've shared, the indicative range would be around ${say(pr.minInr)}${pr.maxInr ? ` to ${say(pr.maxInr)}` : " and up"} rupees. That's indicative only — the final quote depends on the site and exact requirements.`;
}
