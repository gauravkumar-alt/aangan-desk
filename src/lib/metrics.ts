import type { Enquiry } from "./types";

// Every number on the dashboard is computed here from stored enquiries, so the founder never has to
// pull numbers by hand. Definitions are deliberately literal — see METRIC_DEFINITIONS.

export interface Metrics {
  incoming: number;
  answered: number;
  completed: number;
  hungUpEarly: number;
  missed: number;
  answeredWithin5: number;
  answerTimeUnknown: number;
  medianAnswerSec: number | null;
  afterHours: number;
  enquiries: number; // distinct enquiries (a dropped call + its call-back = 1)
  assessed: number;
  qualified: number;
  notQualified: number;
  needsReview: number;
  escalations: number;
  qualificationRate: number | null;
  handoffsSent: number;
  handoffsPending: number;
  crmPending: number;
  medianHandoffSec: number | null;
  pipelineMinInr: number;
  pipelineMaxInr: number;
  pipelinePriced: number;
  pipelineUnpriced: number;
  pipelinePlaceholder: boolean;
  aiCostInr: number;
  costPerEnquiryInr: number | null;
  costPerQualifiedInr: number | null;
  totalMinutes: number;
  consultationsBooked: number;
  outcomesRecorded: number;
  won: number;
  wonValueInr: number;
  conversionRate: number | null; // won ÷ handoffs with a recorded outcome — null until outcomes exist
  callbacksNeeded: Enquiry[];
}

export const METRIC_DEFINITIONS: Record<string, string> = {
  incoming: "Every inbound call received, including missed and dropped calls.",
  answered: "Calls the AI desk picked up (completed + dropped mid-call).",
  completed: "Answered calls that ran to a natural end.",
  answeredWithin5: "Answered calls where ring → pickup was ≤ 5 minutes. Calls whose pickup time wasn't reported are not counted.",
  qualificationRate: "Qualified ÷ assessed enquiries. Excludes existing-client escalations and calls continued in a later call.",
  pipeline: "Sum of indicative ranges for qualified enquiries that could be priced. An estimate of opportunity — not revenue, not a quote.",
  aiCost: "Σ per-call cost = billed minutes × configured ₹/min (see Settings). Not a Vaani invoice.",
  costPerEnquiry: "Total AI cost ÷ distinct enquiries.",
  costPerQualified: "Total AI cost ÷ qualified enquiries.",
  conversion: "Projects won ÷ designer handoffs with an outcome recorded by the studio. Shown only once real outcomes are entered.",
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export function computeMetrics(all: Enquiry[]): Metrics {
  const answeredCalls = all.filter((e) => e.callStatus === "completed" || e.callStatus === "hung_up_early");
  const live = all.filter((e) => !e.supersededBy);
  const assessedList = live.filter((e) => (e.callStatus === "completed" || e.callStatus === "hung_up_early") && e.intent !== "existing_client");
  const qualifiedList = assessedList.filter((e) => e.qualificationStatus === "QUALIFIED");
  const designerHandoffs = all.filter((e) => e.handoff.kind === "designer");
  const sent = designerHandoffs.filter((e) => e.handoff.status === "SENT");
  const priced = qualifiedList.filter((e) => e.pricing.status === "estimated" && e.indicativePriceMin != null && e.indicativePriceMax != null);
  const aiCost = all.reduce((s, e) => s + (e.aiCost || 0), 0);
  const withOutcome = sent.filter((e) => e.outcome.status !== "open");
  const won = all.filter((e) => e.outcome.status === "won");

  return {
    incoming: all.length,
    answered: answeredCalls.length,
    completed: all.filter((e) => e.callStatus === "completed").length,
    hungUpEarly: all.filter((e) => e.callStatus === "hung_up_early").length,
    missed: all.filter((e) => e.callStatus === "missed" || e.callStatus === "failed").length,
    answeredWithin5: answeredCalls.filter((e) => e.answerDelaySec != null && e.answerDelaySec <= 300).length,
    answerTimeUnknown: answeredCalls.filter((e) => e.answerDelaySec == null).length,
    medianAnswerSec: median(answeredCalls.map((e) => e.answerDelaySec).filter((x): x is number => x != null)),
    afterHours: all.filter((e) => e.afterHours).length,
    enquiries: live.length,
    assessed: assessedList.length,
    qualified: qualifiedList.length,
    notQualified: assessedList.filter((e) => e.qualificationStatus === "NOT_QUALIFIED").length,
    needsReview: assessedList.filter((e) => e.qualificationStatus === "NEEDS_REVIEW").length,
    escalations: live.filter((e) => e.intent === "existing_client").length,
    qualificationRate: assessedList.length ? qualifiedList.length / assessedList.length : null,
    handoffsSent: sent.length,
    crmPending: all.filter((e) => e.crm?.status === "PENDING").length,
    handoffsPending: all.filter((e) => e.handoff.required && e.handoff.status === "PENDING").length,
    // replayed calls were handed off long after the original call, so they'd distort this
    medianHandoffSec: median(sent.filter((e) => e.source !== "replay" && e.endedAt && e.handoff.sentAt).map((e) => Math.max(0, (new Date(e.handoff.sentAt!).getTime() - new Date(e.endedAt!).getTime()) / 1000))),
    pipelineMinInr: priced.reduce((s, e) => s + (e.indicativePriceMin ?? 0), 0),
    pipelineMaxInr: priced.reduce((s, e) => s + (e.indicativePriceMax ?? 0), 0),
    pipelinePriced: priced.length,
    pipelineUnpriced: qualifiedList.length - priced.length,
    pipelinePlaceholder: priced.some((e) => e.pricing.source === "placeholder"),
    aiCostInr: +aiCost.toFixed(2),
    costPerEnquiryInr: live.length ? +(aiCost / live.length).toFixed(2) : null,
    costPerQualifiedInr: qualifiedList.length ? +(aiCost / qualifiedList.length).toFixed(2) : null,
    totalMinutes: +all.reduce((s, e) => s + (e.cost?.billedMinutes ?? 0), 0).toFixed(1),
    consultationsBooked: all.filter((e) => e.consultation?.status === "booked").length,
    outcomesRecorded: all.filter((e) => e.outcome.status !== "open").length,
    won: won.length,
    wonValueInr: won.reduce((s, e) => s + (e.outcome.valueInr ?? 0), 0),
    conversionRate: withOutcome.length ? withOutcome.filter((e) => e.outcome.status === "won").length / withOutcome.length : null,
    callbacksNeeded: live.filter((e) => e.callStatus === "missed" || e.callStatus === "failed" || (e.callStatus === "hung_up_early" && e.qualificationStatus !== "QUALIFIED")),
  };
}
