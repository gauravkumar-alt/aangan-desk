import type { Enquiry } from "./types";
import { istParts } from "./hours";

// Consultation scheduling, kept deliberately light: the designer gets a one-click Google Calendar event
// (pre-filled with the brief) and an .ics invite for any calendar app. They pick/confirm the slot with
// the caller, then mark it booked in the dashboard. No OAuth, no calendar API — see README for the
// production upgrade (Google Calendar API / Cal.com booking link).

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

/** Suggested slot: the next working day at 11:00 IST (Mon–Fri), one hour. The designer can change it. */
export function suggestedSlot(from: Date, days = [1, 2, 3, 4, 5]): { start: Date; end: Date } {
  let d = new Date(from.getTime() + 864e5);
  for (let i = 0; i < 7 && !days.includes(istParts(d).day); i++) d = new Date(d.getTime() + 864e5);
  const ist = new Date(d.getTime() + 330 * 60_000);
  const start = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 11, 0) - 330 * 60_000);
  return { start, end: new Date(start.getTime() + 3600e3) };
}

function details(e: Enquiry) {
  const lines = [
    `Consultation — ${e.callerName ?? "caller"} (${e.phone ?? "number not captured"})`,
    "",
    e.handoff.note?.text ?? e.qualificationReason,
    "",
    "Booked via Aangan front desk. Confirm the time with the caller before sending the invite.",
  ];
  return lines.join("\n");
}

export function consultationTitle(e: Enquiry) {
  return `Aangan consultation: ${e.callerName ?? e.phone ?? "new enquiry"}${e.location ? ` — ${e.location.split(",")[0]}` : ""}`;
}

/**
 * Calendly booking page, pre-filled with the caller's name and the brief (Calendly supports `name`, `email`
 * and `a1`… query params for prefill). The designer opens it on the call-back, or shares it with the caller.
 */
export function calendlyLink(e: Enquiry, base: string) {
  const u = new URL(base);
  if (e.callerName) u.searchParams.set("name", e.callerName);
  const brief = [e.phone, e.propertyType, e.location?.split(",")[0], e.scope === "full" ? "full scope" : e.spaces.join(", "), e.timeline].filter(Boolean).join(" · ");
  if (brief) u.searchParams.set("a1", brief.slice(0, 250));
  return u.toString();
}

export function googleCalendarLink(e: Enquiry, slot = suggestedSlot(new Date())) {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: consultationTitle(e),
    dates: `${stamp(slot.start)}/${stamp(slot.end)}`,
    details: details(e).slice(0, 1500),
    location: e.location ?? "",
    ctz: "Asia/Kolkata",
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

export function icsInvite(e: Enquiry, slot = suggestedSlot(new Date())) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Aangan Studio//Front desk//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.id}@aangan-desk`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(slot.start)}`,
    `DTEND:${stamp(slot.end)}`,
    `SUMMARY:${icsEscape(consultationTitle(e))}`,
    `LOCATION:${icsEscape(e.location ?? "")}`,
    `DESCRIPTION:${icsEscape(details(e))}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
