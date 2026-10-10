"use client";
import Link from "next/link";
import { useState } from "react";
import type { Enquiry, HandoffStatus, QualificationStatus } from "@/lib/types";

export const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const fmtDur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`);
export const fmtInr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const fmtLakh = (n: number) => (n >= 1e7 ? `₹${+(n / 1e7).toFixed(2)} Cr` : `₹${+(n / 1e5).toFixed(1)}L`);
export const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

const Q: Record<QualificationStatus, [string, string]> = {
  QUALIFIED: ["QUALIFIED", "bg-ok-soft text-ok ring-ok/25"],
  NOT_QUALIFIED: ["NOT QUALIFIED", "bg-bad-soft text-bad ring-bad/25"],
  NEEDS_REVIEW: ["NEEDS REVIEW", "bg-warn-soft text-warn ring-warn/25"],
  PENDING: ["NOT ASSESSED", "bg-line-2 text-ink-2 ring-line"],
};

export function Badge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={cls("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.06em] whitespace-nowrap ring-1", tone)}>{children}</span>;
}

export function QualBadge({ e }: { e: Pick<Enquiry, "qualificationStatus" | "intent" | "callStatus"> }) {
  if (e.intent === "existing_client") return <Badge tone="bg-info-soft text-info ring-info/25">ESCALATION</Badge>;
  if (e.callStatus === "missed" || e.callStatus === "failed") return <Badge tone="bg-bad-soft text-bad ring-bad/25">MISSED</Badge>;
  const [t, c] = Q[e.qualificationStatus];
  return <Badge tone={c}>{t}</Badge>;
}

export function HandoffBadge({ e, compact }: { e: Pick<Enquiry, "handoff">; compact?: boolean }) {
  const s: HandoffStatus = e.handoff.status;
  if (s === "NOT_REQUIRED") return <span className="text-muted">—</span>;
  if (s === "SENT")
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <Badge tone="bg-ok-soft text-ok ring-ok/25">HANDOFF SENT</Badge>
        {!compact && <span className="text-[11px] text-muted">{channelName(e.handoff.channel)}</span>}
      </span>
    );
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Badge tone="bg-warn-soft text-warn ring-warn/25">HANDOFF PENDING</Badge>
      {!compact && e.handoff.lastError && <span className="max-w-[160px] truncate text-[11px] text-bad" title={e.handoff.lastError}>{e.handoff.lastError}</span>}
    </span>
  );
}

export const channelName = (c: string | null) => (c === "telegram" ? "Telegram" : c === "email" ? "Email" : c === "demo-inbox" ? "Demo inbox" : c ?? "");
export const sourceLabel = (s: Enquiry["source"]) => (s === "vaani" ? "Phone · Vaani" : s === "simulator" ? "Test call" : "Sep 2026 replay");

/** Plain English for the project — never raw system values. */
export function projectText(e: Enquiry): string | null {
  if (e.intent === "existing_client") return "Existing client";
  if (e.callStatus === "missed" || e.callStatus === "failed") return null;
  const kind: Record<string, string> = { residential: "Home", office: "Office", clinic: "Clinic", studio: "Studio", hospitality: "Restaurant / hotel", retail: "Retail", fitness: "Gym", other_commercial: "Commercial" };
  const what = e.propertyType && !/^(office|clinic|studio|apartment)$/i.test(e.propertyType) ? e.propertyType.replace(/ apartment$/i, "") : e.projectType ? kind[e.projectType] : null;
  const scope = e.scope === "full" ? (e.projectType === "residential" ? "whole home" : "full fit-out") : e.scope === "partial" ? (e.spaces.length === 1 ? e.spaces[0].toLowerCase() : "selected rooms") : e.scope === "advisory" ? "advice only" : null;
  return [what, scope].filter(Boolean).join(" · ") || null;
}

export interface SystemsStatus {
  vaani: { provider: string; apiKey: boolean; webhookSecret: boolean };
  handoff: { active: string; label: string };
  crm: { active: string | null; label: string | null };
  store: string;
  rulesOk: boolean;
}

function StatusDot({ s }: { s: SystemsStatus }) {
  const [open, setOpen] = useState(false);
  const rows: [string, string, boolean][] = [
    ["Voice", `${s.vaani.provider}${s.vaani.apiKey && s.vaani.webhookSecret ? "" : " · demo"}`, s.vaani.apiKey && s.vaani.webhookSecret],
    ["Designer handoff", channelName(s.handoff.active) || s.handoff.label, s.handoff.active === "email" || s.handoff.active === "telegram"],
    ["CRM", s.crm.label ?? "Not connected", Boolean(s.crm.active)],
    ["Rules", s.rulesOk ? "Studio files loaded" : "Check rules", s.rulesOk],
    ["Storage", s.store === "supabase" ? "Supabase" : "Local file", s.store === "supabase"],
  ];
  const allOk = rows.slice(0, 4).every((r) => r[2]);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="btn !px-3" aria-expanded={open}>
        <span className={cls("h-2 w-2 rounded-full", allOk ? "bg-ok breathe" : "bg-warn")} />
        {allOk ? "All systems live" : "Check systems"}
      </button>
      {open && (
        <div className="card fade-in absolute right-0 z-50 mt-2 w-72 p-3" onMouseLeave={() => setOpen(false)}>
          {rows.map(([k, v, ok]) => (
            <div key={k} className="flex items-center gap-2 py-1.5 text-[13px]">
              <span className={cls("h-1.5 w-1.5 shrink-0 rounded-full", ok ? "bg-ok" : "bg-warn")} />
              <span className="w-32 shrink-0 text-muted">{k}</span>
              <span className="truncate">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Header({ active, right, status }: { active: "dashboard" | "call" | "rules"; right?: React.ReactNode; status?: SystemsStatus }) {
  const tab = (href: string, id: string, label: string) => (
    <Link href={href} className={cls("rounded-full px-3.5 py-1.5 text-[13px] font-medium transition", active === id ? "bg-ink text-paper" : "text-ink-2 hover:bg-white/5 hover:text-ink")}>
      {label}
    </Link>
  );
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-paper/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1320px] items-center gap-3 px-4 py-3 md:px-6">
        <Link href="/" className="mr-1 flex items-center gap-2.5">
          <span className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-[#e8885a] to-[#9c4322] text-[16px] font-bold text-white shadow-[0_8px_24px_-8px_rgba(224,120,74,.8)]">आ</span>
          <span className="hidden leading-tight sm:block">
            <span className="font-display block text-[19px] leading-none">Aangan Studio</span>
            <span className="block text-[10.5px] tracking-[0.16em] text-muted uppercase">AI front desk</span>
          </span>
        </Link>
        <nav className="flex gap-1 rounded-full border border-white/[0.07] bg-white/[0.03] p-1">
          {tab("/", "dashboard", "Dashboard")}
          {tab("/call", "call", "Test a call")}
          {tab("/rules", "rules", "Rules")}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {status && <StatusDot s={status} />}
          {right}
        </div>
      </div>
    </header>
  );
}

export function Pill({ ok, children, title }: { ok: boolean | "warn"; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-2">
      <span className={cls("h-1.5 w-1.5 rounded-full", ok === true ? "bg-ok" : ok === "warn" ? "bg-warn" : "bg-bad")} />
      {children}
    </span>
  );
}
