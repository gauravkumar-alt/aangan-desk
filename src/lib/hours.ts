import type { ServicesRules } from "./rules/schema";

const IST_OFFSET_MIN = 330;

/** Wall-clock parts in India Standard Time (no DST, so a fixed offset is exact). */
export function istParts(d: Date) {
  const ist = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return { day: ist.getUTCDay(), minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(), hour: ist.getUTCHours() };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Is the front desk staffed at this moment? Falls back to the brief's 10am–7pm if services.md isn't loaded. */
export function isWithinHours(d: Date, hours?: ServicesRules["hours"] | null): boolean {
  const open = toMin(hours?.open ?? "10:00");
  const close = toMin(hours?.close ?? "19:00");
  const days = hours?.days ?? [1, 2, 3, 4, 5, 6, 0];
  const p = istParts(d);
  return days.includes(p.day) && p.minutes >= open && p.minutes < close;
}

export function fmtIST(iso: string, opts: Intl.DateTimeFormatOptions = {}) {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...opts });
}
