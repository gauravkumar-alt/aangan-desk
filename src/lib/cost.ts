import type { CostBreakdown, Settings } from "./types";

// Transparent per-call cost. VaaniYantra bills voice minutes (metric `voice.minutes`) at a rate agreed
// per client; its public webhook doesn't carry the cost, so by default we compute it from the call
// duration × the configured rate and label it as such. If a billed figure is ever supplied
// (vaaniReportedInr), that wins.

export function computeCost(durationSec: number, s: Settings, vaaniReportedInr?: number | null): CostBreakdown {
  const inc = Math.max(1, s.billingIncrementSec || 60);
  const billedSec = durationSec > 0 ? Math.ceil(durationSec / inc) * inc : 0;
  const billedMinutes = +(billedSec / 60).toFixed(2);
  if (vaaniReportedInr != null && vaaniReportedInr >= 0) {
    return {
      durationSec,
      billedMinutes,
      ratePerMinInr: s.vaaniRatePerMinInr,
      telephonyPerMinInr: s.telephonyPerMinInr,
      estimatedInr: +vaaniReportedInr.toFixed(2),
      basis: "vaani_reported",
      note: "Cost reported by Vaani for this call.",
    };
  }
  const perMin = s.vaaniRatePerMinInr + s.telephonyPerMinInr;
  return {
    durationSec,
    billedMinutes,
    ratePerMinInr: s.vaaniRatePerMinInr,
    telephonyPerMinInr: s.telephonyPerMinInr,
    estimatedInr: +(billedMinutes * perMin).toFixed(2),
    basis: "configured_rate",
    note: `Estimate: ${billedMinutes} billed min × ₹${perMin}/min (configured${s.telephonyPerMinInr ? ", incl. telephony" : ""}). Not a Vaani invoice.`,
  };
}
