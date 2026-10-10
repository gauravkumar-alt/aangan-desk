import "server-only";
import type { Notifier } from "./index";
import { withTimeout } from "./index";
import type { HandoffNote } from "../types";
import { calendlyLink, googleCalendarLink } from "../calendar";

// Telegram Bot API: https://core.telegram.org/bots/api#sendmessage
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (designers' group), TELEGRAM_ESCALATION_CHAT_ID (optional).

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function telegramHtml(note: HandoffNote, dashboardUrl?: string, calendarUrl?: string) {
  const body = [
    `<b>${esc(note.title)}</b>`,
    "",
    ...note.lines.map((l) => `<b>${esc(l.label)}:</b> ${esc(l.value)}`),
    "",
    "<b>Important notes:</b>",
    ...(note.importantNotes.length ? note.importantNotes.map((n) => `• ${esc(n)}`) : ["• —"]),
    "",
    `<b>Recommended next step:</b> ${esc(note.nextStep)}`,
    calendarUrl ? `\n📅 <a href="${esc(calendarUrl)}">Book the consultation</a>` : "",
    dashboardUrl ? `<a href="${esc(dashboardUrl)}">Open in Aangan desk</a>` : "",
  ].join("\n");
  return body.length > 4000 ? body.slice(0, 3990) + "…" : body; // Telegram caps messages at 4096 chars
}

export function telegramNotifier(): Notifier {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  return {
    id: "telegram",
    label: "Telegram",
    configured: Boolean(token && chat),
    async send(note, enquiry, kind) {
      if (!token || !chat) return { ok: false, error: "Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing).", retryable: true };
      const chatId = kind === "escalation" ? process.env.TELEGRAM_ESCALATION_CHAT_ID || chat : chat;
      const base = process.env.APP_BASE_URL?.replace(/\/$/, "");
      const link = base?.startsWith("https://") ? `${base}/?enquiry=${enquiry.id}` : undefined;
      try {
        const res = await withTimeout(8000, (signal) =>
          fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: telegramHtml(note, link, kind === "designer" ? (process.env.CALENDLY_URL ? calendlyLink(enquiry, process.env.CALENDLY_URL) : googleCalendarLink(enquiry)) : undefined), parse_mode: "HTML", disable_web_page_preview: true }),
            signal,
          }),
        );
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id?: number }; parameters?: { retry_after?: number } };
        if (!res.ok || !json.ok) {
          // 429 / 5xx are worth retrying; 400/403 (bad chat, bot removed) need a config fix.
          const retryable = res.status === 429 || res.status >= 500;
          return { ok: false, error: `Telegram ${res.status}: ${json.description ?? res.statusText}`, retryable };
        }
        return { ok: true, externalId: String(json.result?.message_id ?? "") };
      } catch (e) {
        const msg = (e as Error).name === "AbortError" ? "Telegram timed out after 8s" : `Network error reaching Telegram: ${(e as Error).message}`;
        return { ok: false, error: msg, retryable: true };
      }
    },
  };
}
