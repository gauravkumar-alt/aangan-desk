import "server-only";
import type { Notifier } from "./index";
import { withTimeout } from "./index";
import { calendlyLink, googleCalendarLink } from "../calendar";

// Email fallback via Resend's REST API (https://resend.com/docs/api-reference/emails/send-email).
// Not the default channel — see README for why Telegram was chosen — but it plugs into the same
// interface so switching is HANDOFF_CHANNEL=email.
// Env: RESEND_API_KEY, HANDOFF_EMAIL_TO, HANDOFF_EMAIL_FROM (defaults to Resend's test sender).

export function emailNotifier(): Notifier {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.HANDOFF_EMAIL_TO;
  return {
    id: "email",
    label: "Email",
    configured: Boolean(key && to),
    async send(note, enquiry, kind) {
      if (!key || !to) return { ok: false, error: "Email not configured (RESEND_API_KEY / HANDOFF_EMAIL_TO missing).", retryable: true };
      try {
        const res = await withTimeout(8000, (signal) =>
          fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `handoff-${enquiry.id}` },
            body: JSON.stringify({
              from: process.env.HANDOFF_EMAIL_FROM || "Aangan Front Desk <onboarding@resend.dev>",
              to: to.split(",").map((s) => s.trim()),
              subject: `${note.title.replace(/^\W+/, "")}: ${enquiry.callerName ?? enquiry.phone ?? "Caller"} — ${enquiry.location ?? ""}`,
              text:
                kind === "designer"
                  ? `${note.text}\n\n📅 Book the consultation: ${process.env.CALENDLY_URL ? calendlyLink(enquiry, process.env.CALENDLY_URL) : googleCalendarLink(enquiry)}`
                  : note.text,
            }),
            signal,
          }),
        );
        const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
        if (!res.ok) return { ok: false, error: `Email ${res.status}: ${json.message ?? res.statusText}`, retryable: res.status === 429 || res.status >= 500 };
        return { ok: true, externalId: json.id };
      } catch (e) {
        return { ok: false, error: `Network error sending email: ${(e as Error).message}`, retryable: true };
      }
    },
  };
}
