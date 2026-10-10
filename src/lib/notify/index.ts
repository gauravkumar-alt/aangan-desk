import "server-only";
import type { Enquiry, HandoffNote } from "../types";
import { telegramNotifier } from "./telegram";
import { emailNotifier } from "./email";
import { demoInboxNotifier } from "./demo";

// One interface for every handoff channel. Qualification and storage never know which one is in use,
// so swapping Telegram for email is a config change (HANDOFF_CHANNEL), not a rewrite.

export interface SendResult {
  ok: boolean;
  externalId?: string;
  error?: string;
  retryable?: boolean;
}

export interface Notifier {
  id: string; // "telegram" | "email" | "demo-inbox"
  label: string;
  configured: boolean;
  send(note: HandoffNote, enquiry: Enquiry, kind: "designer" | "escalation"): Promise<SendResult>;
}

export function getNotifier(): Notifier {
  const wanted = (process.env.HANDOFF_CHANNEL || "telegram").toLowerCase();
  const tg = telegramNotifier();
  const em = emailNotifier();
  if (wanted === "email" && em.configured) return em;
  if (tg.configured) return tg;
  if (wanted === "email" && !em.configured && demoMode()) return demoInboxNotifier("Email is not configured");
  // Demo mode with nothing configured: deliver to the in-app designer inbox, clearly labelled.
  if (demoMode()) return demoInboxNotifier("Telegram is not configured");
  return wanted === "email" ? em : tg; // unconfigured → send() fails → HANDOFF PENDING
}

export function demoMode() {
  return (process.env.DEMO_MODE ?? "true").toLowerCase() !== "false";
}

export function channelStatus() {
  const tg = telegramNotifier();
  const em = emailNotifier();
  const active = getNotifier();
  return { active: active.id, label: active.label, telegram: tg.configured, email: em.configured, demo: demoMode() };
}

export async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fn(ctl.signal);
  } finally {
    clearTimeout(timer);
  }
}
