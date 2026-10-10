// The enquiry record — one per inbound call. Everything the dashboard, the handoff and the cost view
// read comes from here. Keep it additive: new fields should be optional so older records still load.

export type QualificationStatus = "QUALIFIED" | "NOT_QUALIFIED" | "NEEDS_REVIEW" | "PENDING";
export type HandoffStatus = "NOT_REQUIRED" | "PENDING" | "SENT" | "FAILED";
export type CallStatus = "completed" | "hung_up_early" | "missed" | "failed";
export type EnquirySource = "vaani" | "simulator" | "replay";

export type ProjectType = "residential" | "office" | "clinic" | "studio" | "hospitality" | "retail" | "fitness" | "other_commercial";
export type Scope = "full" | "partial" | "advisory";
export type Intent = "new_project" | "existing_client" | "other";
export type LocationStatus = "in_area" | "edge" | "outside" | "unrecognised";

/** What we learned on the call. `null` = never captured; see unknownFields / declinedFields for why. */
export interface EnquiryFacts {
  callerName: string | null;
  intent: Intent | null;
  projectType: ProjectType | null;
  propertyType: string | null; // "3BHK apartment", "villa", "office (bare shell)"
  location: string | null;
  locationStatus: LocationStatus | null;
  areaSqFt: number | null;
  areaSqFtRange: [number, number] | null; // when the caller gave a range ("1,000–1,200")
  spaces: string[];
  scope: Scope | null;
  projectStage: string | null; // "new possession", "lived-in", "bare shell", "new construction"
  siteAvailableDate: string | null; // ISO date the site can take execution (possession etc.), if later than now
  notOffered: "structural" | "decor_only" | "furniture_only" | "vastu_only" | "diy_execution" | null; // services.md › What we don't do
  specTier: "standard" | "premium" | "luxury" | null; // only if the caller said so
  ownership: "owner" | "rented" | "family" | null;
  // yes = decides; authorised = calling for someone who's authorised them; family_attending = researching for family
  // who will attend (unclear → qualify and note); no = research only, not authorised (qualified.md › 5)
  decisionMaker: "yes" | "authorised" | "family_attending" | "no" | null;
  structuralChanges: boolean | null;
  timeline: string | null; // caller's words, normalised
  timelineDeadline: string | null; // ISO date the caller needs it DONE by, if they gave one
  timelineFlexible: boolean | null;
  budget: string | null;
  budgetMinInr: number | null;
  budgetMaxInr: number | null;
  exploring: boolean | null;
  referral: string | null;
  callbackPreference: string | null; // "tomorrow around 7pm", "weekday mornings"
  requirements: string | null;
  constraints: string | null;
}

export interface Correction {
  field: keyof EnquiryFacts;
  from: string;
  to: string;
  at: string;
}

export interface RuleCheck {
  ruleId: string;
  criterion?: string; // "#3 Realistic timeline" — which qualified.md criterion this belongs to
  outcome: "PASS" | "NOT_QUALIFIED" | "NEEDS_REVIEW" | "ESCALATE" | "INFO";
  message: string;
  evidence: string[]; // transcript IDs / source lines from case/*.md
  ambiguity?: string;
}

export interface Pricing {
  status: "estimated" | "insufficient_info" | "designer_quote" | "not_applicable" | "rules_missing";
  minInr: number | null;
  maxInr: number | null; // null with a min = open-ended ("₹3,500+ per sq ft" luxury tier)
  rateId: string | null; // tier used
  basis: string; // human-readable working: "1,400 sq ft × ₹1,800–2,400/sq ft (Standard)"
  alternatives: { label: string; minInr: number; maxInr: number | null }[]; // other tiers, for the designer
  source: "approved" | "placeholder" | "none";
  internalOnly: boolean; // pricing.md: never quoted to the caller
  disclaimer: string;
}

export interface HandoffAttempt {
  at: string;
  channel: string;
  ok: boolean;
  error?: string;
  externalId?: string;
}

export interface Handoff {
  required: boolean;
  kind: "designer" | "escalation" | null;
  status: HandoffStatus;
  channel: string | null;
  attempts: HandoffAttempt[];
  sentAt: string | null;
  lastError: string | null;
  note: HandoffNote | null;
}

export interface HandoffNote {
  title: string;
  lines: { label: string; value: string }[];
  importantNotes: string[];
  nextStep: string;
  text: string; // plain-text version (email / copy)
}

export interface TranscriptTurn {
  role: "AGENT" | "CALLER";
  text: string;
  atMs?: number;
}

export interface CrmSync {
  provider: string; // "zoho" | "hubspot"
  recordType?: "Lead" | "Contact" | "contact"; // Zoho: Lead until a qualified enquiry converts it
  status: "SYNCED" | "PENDING" | "SKIPPED";
  contactId: string | null;
  dealId: string | null;
  noteIds: string[]; // one note per synced state, so re-syncs don't duplicate
  syncedHash: string | null; // what was last written — skip identical re-syncs
  lastError: string | null;
  attempts: { at: string; ok: boolean; error?: string }[];
  skippedReason?: string;
}

export interface CostBreakdown {
  durationSec: number;
  billedMinutes: number; // rounded up per the configured billing increment
  ratePerMinInr: number;
  telephonyPerMinInr: number;
  estimatedInr: number;
  basis: "vaani_reported" | "configured_rate";
  note: string;
}

export interface Outcome {
  status: "open" | "won" | "lost";
  valueInr: number | null; // actual signed project value — only ever entered by a person
  recordedAt: string | null;
  note: string | null;
}

export interface Enquiry extends EnquiryFacts {
  id: string;
  createdAt: string; // call received (ring start)
  source: EnquirySource;
  vaaniCallId: string | null;
  phone: string | null;
  callStatus: CallStatus;
  answeredAt: string | null;
  endedAt: string | null;
  answerDelaySec: number | null; // ring → answer; the five-minute objective is measured on this
  afterHours: boolean;
  callDurationSeconds: number;

  qualificationStatus: QualificationStatus;
  qualificationReason: string;
  checks: RuleCheck[];
  flags: string[]; // priority flags: referral, repeat caller, large project
  missingInfo: string[];
  unknownFields: string[]; // caller didn't know
  declinedFields: string[]; // caller preferred not to say
  corrections: Correction[];
  recommendedNextAction: string;
  rulesStatus: string; // which rules version decided this ("derived-from-transcripts", "approved"...)

  pricing: Pricing;
  indicativePriceMin: number | null;
  indicativePriceMax: number | null;

  handoffRequired: boolean;
  handoffStatus: HandoffStatus;
  handoff: Handoff;

  aiCost: number;
  cost: CostBreakdown;

  transcript: TranscriptTurn[];
  transcriptStatus: "complete" | "pending_fetch" | "fetch_failed" | "not_available";
  summary: string | null;
  notes: string;

  outcome: Outcome;
  crm: CrmSync | null; // HubSpot (or another CRM) sync state
  consultation: { status: "not_booked" | "booked"; at: string | null; bookedAt: string | null } | null; // marked by the designer
  review: { decision: "approved" | "closed"; at: string; note: string | null } | null; // front desk's call on a NEEDS REVIEW
  repeatCaller: boolean; // called before and wasn't followed up / rang again (T16)
  previousEnquiryId: string | null; // same caller rang back (dropped line etc.)
  supersededBy: string | null; // this call was continued in a later one — excluded from enquiry counts
  replayOf?: string; // transcript ID when source = "replay"
  processingErrors: string[];
  updatedAt: string;
}

export const EMPTY_FACTS: EnquiryFacts = {
  callerName: null,
  intent: null,
  projectType: null,
  propertyType: null,
  location: null,
  locationStatus: null,
  areaSqFt: null,
  areaSqFtRange: null,
  spaces: [],
  scope: null,
  projectStage: null,
  siteAvailableDate: null,
  notOffered: null,
  specTier: null,
  ownership: null,
  decisionMaker: null,
  structuralChanges: null,
  timeline: null,
  timelineDeadline: null,
  timelineFlexible: null,
  budget: null,
  budgetMinInr: null,
  budgetMaxInr: null,
  exploring: null,
  referral: null,
  callbackPreference: null,
  requirements: null,
  constraints: null,
};

export interface Settings {
  vaaniRatePerMinInr: number;
  telephonyPerMinInr: number;
  billingIncrementSec: number;
  rateLabel: string;
  // Demo-only fault injection, so the failure paths can be shown without breaking real integrations.
  simulateHandoffFailure: boolean;
  simulateVaaniApiFailure: boolean;
  updatedAt: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  vaaniRatePerMinInr: 5.6,
  telephonyPerMinInr: 0,
  billingIncrementSec: 60,
  rateLabel: "₹5.60/min is the per-minute estimate VaaniVoice shows for the Aangan agent (agent Overview page). It's VaaniVoice's estimate, not an invoice — update it if your plan's rate differs.",
  simulateHandoffFailure: false,
  simulateVaaniApiFailure: false,
  updatedAt: null,
};

export interface WebhookEventRecord {
  key: string; // idempotency key
  event: string;
  callId: string;
  receivedAt: string;
  status: "processing" | "processed" | "failed";
  enquiryId: string | null;
  error: string | null;
  attempts: number;
  rawBody: string;
}
