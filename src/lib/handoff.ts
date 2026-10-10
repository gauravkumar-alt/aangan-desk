// The note a designer reads before calling back. Its job: the designer never has to re-ask what the
// front desk already asked. Channel-agnostic — notifiers decide how to render it.

import type { Enquiry, HandoffNote } from "./types";
import { fmtIST } from "./hours";
import { lakhRange } from "./pricing";

const dash = "—";
const or = (v: string | null | undefined, fallback = "Not captured") => (v && String(v).trim() ? String(v) : fallback);

function described(e: Enquiry, field: string, value: string | null | undefined) {
  if (value && String(value).trim()) return String(value);
  if (e.declinedFields.includes(field)) return "Preferred not to say";
  if (e.unknownFields.includes(field)) return "Caller didn't know";
  return "Not captured";
}

export function buildHandoffNote(e: Enquiry, kind: "designer" | "escalation"): HandoffNote {
  if (kind === "escalation") {
    const lines = [
      { label: "Name", value: or(e.callerName) },
      { label: "Phone", value: or(e.phone) },
      { label: "Called", value: fmtIST(e.createdAt, { dateStyle: "medium", timeStyle: "short" }) },
      { label: "Property", value: [e.propertyType, e.location].filter(Boolean).join(", ") || "Not captured" },
      { label: "What happened", value: or(e.summary ?? e.notes) },
    ];
    const nextStep = e.recommendedNextAction;
    const title = "⚠️ EXISTING CLIENT — ESCALATION";
    return { title, lines, importantNotes: e.flags, nextStep, text: render(title, lines, e.flags, nextStep) };
  }

  const pr = e.pricing;
  const priceText =
    pr.status === "estimated" && pr.minInr
      ? `${lakhRange(pr.minInr, pr.maxInr)} — ${pr.basis}.${pr.alternatives.length ? ` Other tiers: ${pr.alternatives.map((a) => `${a.label} ${lakhRange(a.minInr, a.maxInr)}`).join(", ")}.` : ""} INTERNAL — not shared with the caller.`
      : pr.status === "designer_quote"
        ? "Designer to quote (selected rooms)"
        : `Not estimated — ${pr.basis}`;

  const area = e.areaSqFt
    ? `${e.areaSqFtRange ? `${e.areaSqFtRange[0].toLocaleString("en-IN")}–${e.areaSqFtRange[1].toLocaleString("en-IN")}` : e.areaSqFt.toLocaleString("en-IN")} sq ft`
    : described(e, "areaSqFt", null);

  const lines = [
    { label: "Name", value: or(e.callerName) },
    { label: "Phone", value: or(e.phone) },
    { label: "Best time to call", value: e.callbackPreference ?? "Not specified" },
    { label: "Location", value: described(e, "location", e.location) },
    { label: "Project", value: [e.projectType === "office" ? "Office fitout" : e.projectType === "residential" ? "Home" : e.projectType, e.scope === "full" ? "full scope" : e.scope === "partial" ? "selected rooms" : null].filter(Boolean).join(" — ") || "Not captured" },
    { label: "Property", value: [e.propertyType, e.projectStage, e.specTier ? `${e.specTier} specification (caller's words)` : null].filter(Boolean).join(", ") || "Not captured" },
    { label: "Area", value: area },
    { label: "Requirements", value: [e.spaces.join(", "), e.requirements].filter(Boolean).join(". ") || "Not captured" },
    { label: "Timeline", value: described(e, "timeline", e.timeline) },
    { label: "Budget", value: described(e, "budget", e.budget) },
    { label: "Ownership", value: e.ownership === "rented" ? "Rented" : e.ownership === "family" ? "Family member's property" : e.ownership === "owner" ? "Owner" : "Not captured" },
    { label: "Decision-maker", value: e.decisionMaker === "yes" ? "Caller decides" : e.decisionMaker === "authorised" ? "Caller authorised to go ahead" : e.decisionMaker === "family_attending" ? "Family will attend the consultation; authority not confirmed" : e.decisionMaker === "no" ? "Not authorised" : "Not confirmed" },
    { label: "Indicative pricing (internal)", value: priceText },
    { label: "Qualification", value: e.qualificationStatus.replace("_", " ") },
    { label: "Reason", value: e.qualificationReason },
  ];

  const notes: string[] = [...e.flags];
  if (e.referral) notes.push(`Source: ${e.referral}`);
  if (e.constraints) notes.push(e.constraints);
  for (const c of e.corrections) notes.push(`Caller corrected ${String(c.field)}: "${c.from}" → "${c.to}"`);
  for (const c of e.checks.filter((c) => c.outcome === "INFO")) notes.push(`${c.ambiguity ? "Uncertain" : "Note"}: ${c.message}`);
  if (pr.status === "estimated" && pr.internalOnly) notes.push("No price was discussed with the caller (pricing.md). Pricing is yours to set at the consultation.");
  if (e.missingInfo.length) notes.push(`Not captured: ${e.missingInfo.join(", ")}`);
  if (e.declinedFields.length) notes.push(`Preferred not to say: ${e.declinedFields.join(", ")}`);

  const title = "🏠 NEW QUALIFIED ENQUIRY";
  return { title, lines, importantNotes: notes, nextStep: e.recommendedNextAction, text: render(title, lines, notes, e.recommendedNextAction) };
}

function render(title: string, lines: HandoffNote["lines"], notes: string[], next: string) {
  return [
    title,
    "",
    ...lines.map((l) => `${l.label}: ${l.value}`),
    "",
    "Important notes:",
    ...(notes.length ? notes.map((n) => `• ${n}`) : [`• ${dash}`]),
    "",
    `Recommended next step: ${next}`,
  ].join("\n");
}
