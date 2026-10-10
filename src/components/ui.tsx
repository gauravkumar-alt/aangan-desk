"use client";
import Link from "next/link";
import type { Enquiry, HandoffStatus, QualificationStatus } from "@/lib/types";

export const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const fmtDur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`);
export const fmtInr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const fmtLakh = (n: number) => (n >= 1e7 ? `₹${+(n / 1e7).toFixed(2)} Cr` : `₹${+(n / 1e5).toFixed(1)}L`);
export const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

const Q: Record<QualificationStatus, [string, string]> = {
  QUALIFIED: ["QUALIFIED", "bg-ok-soft text-ok"],
  NOT_QUALIFIED: ["NOT QUALIFIED", "bg-bad-soft text-bad"],
  NEEDS_REVIEW: ["NEEDS REVIEW", "bg-warn-soft text-warn"],
  PENDING: ["NOT ASSESSED", "bg-line-2 text-ink-2"],
};

export function Badge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={cls("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-wide whitespace-nowrap", tone)}>{children}</span>;
}

export function QualBadge({ e }: { e: Pick<Enquiry, "qualificationStatus" | "intent" | "callStatus"> }) {
  if (e.intent === "existing_client") return <Badge tone="bg-info-soft text-info">ESCALATION</Badge>;
  if (e.callStatus === "missed" || e.callStatus === "failed") return <Badge tone="bg-bad-soft text-bad">MISSED</Badge>;
  const [t, c] = Q[e.qualificationStatus];
  return <Badge tone={c}>{t}</Badge>;
}

export function HandoffBadge({ e }: { e: Pick<Enquiry, "handoff"> }) {
  const s: HandoffStatus = e.handoff.status;
  if (s === "NOT_REQUIRED") return <span className="text-muted">—</span>;
  if (s === "SENT")
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <Badge tone="bg-ok-soft text-ok">HANDOFF SENT</Badge>
        <span className="text-[11px] text-muted">{channelName(e.handoff.channel)}</span>
      </span>
    );
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Badge tone="bg-warn-soft text-warn">HANDOFF PENDING</Badge>
      {e.handoff.lastError && <span className="max-w-[160px] truncate text-[11px] text-bad" title={e.handoff.lastError}>{e.handoff.lastError}</span>}
    </span>
  );
}

export const channelName = (c: string | null) => (c === "telegram" ? "Telegram" : c === "email" ? "Email" : c === "demo-inbox" ? "Demo inbox" : c ?? "");

export const sourceLabel = (s: Enquiry["source"]) => (s === "vaani" ? "Vaani" : s === "simulator" ? "Simulated call" : "Sep 2026 replay");

export function Header({ active, right }: { active: "dashboard" | "call" | "rules"; right?: React.ReactNode }) {
  const tab = (href: string, id: string, label: string) => (
    <Link href={href} className={cls("rounded-lg px-3 py-1.5 text-[13px] font-semibold", active === id ? "bg-ink text-white" : "text-ink-2 hover:bg-line-2")}>
      {label}
    </Link>
  );
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-3 px-4 py-3">
        <Link href="/" className="mr-2 flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-[15px] font-bold text-white">आ</span>
          <span className="leading-tight">
            <span className="block text-[15px] font-bold">Aangan Studio</span>
            <span className="block text-[11px] text-muted">AI front desk · phone</span>
          </span>
        </Link>
        <nav className="flex gap-1">
          {tab("/", "dashboard", "Dashboard")}
          {tab("/call", "call", "Test a call")}
          {tab("/rules", "rules", "Rules")}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>
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
