"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardData } from "@/lib/dashboard";
import { computeMetrics, METRIC_DEFINITIONS } from "@/lib/metrics";
import type { Enquiry } from "@/lib/types";
import { EnquiryDrawer } from "./EnquiryDrawer";
import { SettingsPanel } from "./SettingsPanel";
import { Badge, channelName, cls, fmtDur, fmtInr, fmtLakh, fmtTime, HandoffBadge, Header, pct, Pill, QualBadge, sourceLabel } from "./ui";

type Source = "all" | "live" | "replay";
type Filter = "all" | "QUALIFIED" | "NEEDS_REVIEW" | "NOT_QUALIFIED" | "pending" | "missed" | "after";

export function Dashboard({ initial, openId }: { initial: DashboardData; openId?: string }) {
  const [data, setData] = useState(initial);
  const [source, setSource] = useState<Source>(() => (initial.enquiries.some((e) => e.source !== "replay") ? "all" : "all"));
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(openId ?? null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/dashboard", { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, []);
  useEffect(() => {
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const scoped = useMemo(() => data.enquiries.filter((e) => (source === "all" ? true : source === "replay" ? e.source === "replay" : e.source !== "replay")), [data.enquiries, source]);
  const m = useMemo(() => computeMetrics(scoped), [scoped]);
  const rows = useMemo(
    () =>
      scoped.filter((e) => {
        if (filter === "all") return true;
        if (filter === "pending") return e.handoff.status === "PENDING";
        if (filter === "missed") return e.callStatus === "missed" || e.callStatus === "failed";
        if (filter === "after") return e.afterHours;
        return e.qualificationStatus === filter && e.intent !== "existing_client" && !e.supersededBy;
      }),
    [scoped, filter],
  );
  const reviewQueue = scoped.filter((e) => e.qualificationStatus === "NEEDS_REVIEW" && !e.supersededBy && e.intent !== "existing_client" && e.callStatus !== "missed");
  const selected = data.enquiries.find((e) => e.id === open) ?? null;
  const it = data.integrations;

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const within5 = m.answered ? m.answeredWithin5 / m.incoming : null;

  return (
    <>
      <Header
        active="dashboard"
        right={
          <>
            <Pill ok={it.vaani.apiKey && it.vaani.webhookSecret ? true : "warn"} title={it.vaani.apiKey ? "Vaani API key set" : "No VAANI_API_KEY — demo uses the built-in mock of the Vaani calls API"}>
              {it.vaani.provider}: {it.vaani.apiKey && it.vaani.webhookSecret ? "live" : it.vaani.apiKey ? "key set" : "demo"}
            </Pill>
            <Pill ok={it.handoff.active === "telegram" || it.handoff.active === "email" ? true : "warn"} title={it.handoff.label}>
              Handoff: {channelName(it.handoff.active)}
            </Pill>
            <Pill ok={it.crm.active ? true : "warn"} title={it.crm.active ? `${it.crm.label}: every caller is synced; qualified enquiries become deals` : "CRM not connected — see .env.example (Zoho)"}>
              CRM: {it.crm.label ?? "off"}
            </Pill>
            <Pill ok={data.rules.warnings.length ? false : true} title={data.rules.files.map((f) => `${f.name}: ${f.status ?? f.state}`).join("\n")}>
              Rules: {data.rules.warnings.length ? "check" : "studio files"}
            </Pill>
            <button className="btn" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
          </>
        }
      />
      <main className="mx-auto max-w-[1280px] space-y-5 px-4 py-5">
        {data.rules.warnings.length > 0 && (
          <div className="card border-bad/30 bg-bad-soft p-3 text-[13px] text-bad">
            {data.rules.warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        )}

        {/* Source scope */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line bg-surface p-0.5">
            {(
              [
                ["all", "All calls"],
                ["live", "Live & test calls"],
                ["replay", "Sep 2026 replay"],
              ] as [Source, string][]
            ).map(([k, l]) => (
              <button key={k} onClick={() => setSource(k)} className={cls("rounded-md px-3 py-1 text-[13px] font-semibold", source === k ? "bg-ink text-white" : "text-ink-2")}>
                {l}
              </button>
            ))}
          </div>
          {source !== "live" && (
            <span className="text-[12px] text-muted">The replay runs September&apos;s 20 real phone transcripts through this system. Pickup times in the replay are simulated (3s).</span>
          )}
        </div>

        {/* The story: answering fast enough? right ones to designers? */}
        <section className="grid gap-4 md:grid-cols-2">
          <div className="card p-5">
            <div className="label">Are we answering every enquiry fast enough?</div>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="num text-[44px] font-bold leading-none">{pct(within5)}</span>
              <span className="text-ink-2">
                of {m.incoming} calls answered within 5 minutes
                {m.medianAnswerSec != null && <> · median pickup {m.medianAnswerSec}s</>}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-2">
              <span>
                <b className="num">{m.afterHours}</b> after hours ({pct(m.incoming ? m.afterHours / m.incoming : null)})
              </span>
              <span>
                <b className="num">{m.missed}</b> missed
              </span>
              <span>
                <b className="num">{m.hungUpEarly}</b> dropped mid-call
              </span>
              {m.answerTimeUnknown > 0 && <span className="text-warn">{m.answerTimeUnknown} pickup time not reported</span>}
            </div>
          </div>
          <div className="card p-5">
            <div className="label">Are we sending the right ones to designers?</div>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="num text-[44px] font-bold leading-none">
                {m.handoffsSent}
                <span className="text-[24px] text-muted">/{m.qualified}</span>
              </span>
              <span className="text-ink-2">qualified enquiries handed to a designer{m.medianHandoffSec != null && <> · median {Math.round(m.medianHandoffSec)}s after the call</>}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-2">
              <span>
                <b className="num">{m.notQualified}</b> not qualified (closed on the call)
              </span>
              <span>
                <b className="num">{m.needsReview}</b> need review
              </span>
              <span>
                <b className="num">{m.escalations}</b> client escalations
              </span>
            </div>
          </div>
        </section>

        {/* Needs attention */}
        {(m.callbacksNeeded.length > 0 || m.handoffsPending > 0 || m.crmPending > 0 || reviewQueue.length > 0) && (
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-semibold">Needs attention</div>
              {(m.handoffsPending > 0 || m.crmPending > 0) && (
                <button className="btn" disabled={busy !== null} onClick={() => act("retry", () => fetch("/api/handoffs/retry", { method: "POST" }))}>
                  {busy === "retry" ? "Retrying…" : `Retry pending (${[m.handoffsPending && `${m.handoffsPending} handoff`, m.crmPending && `${m.crmPending} CRM`].filter(Boolean).join(", ")})`}
                </button>
              )}
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <AttentionList title="Call back" tone="text-bad" items={m.callbacksNeeded} onOpen={setOpen} />
              <AttentionList title="Handoff pending" tone="text-warn" items={scoped.filter((e) => e.handoff.status === "PENDING")} onOpen={setOpen} />
              <AttentionList title="Needs review" tone="text-warn" items={reviewQueue} onOpen={setOpen} />
            </div>
          </section>
        )}

        {/* Overview + funnel + money */}
        <section className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          <div className="card p-5">
            <div className="mb-3 font-semibold">Overview</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Stat label="Incoming calls" value={m.incoming} def={METRIC_DEFINITIONS.incoming} />
              <Stat label="Answered" value={m.answered} def={METRIC_DEFINITIONS.answered} />
              <Stat label="Completed" value={m.completed} def={METRIC_DEFINITIONS.completed} />
              <Stat label="Answered ≤ 5 min" value={m.answeredWithin5} def={METRIC_DEFINITIONS.answeredWithin5} />
              <Stat label="Qualification rate" value={pct(m.qualificationRate)} sub={`${m.qualified} of ${m.assessed} assessed`} def={METRIC_DEFINITIONS.qualificationRate} />
              <Stat label="Designer handoffs" value={m.handoffsSent} sub={m.handoffsPending ? `${m.handoffsPending} pending` : undefined} />
              <Stat label="Qualified" value={m.qualified} />
              <Stat label="Not qualified" value={m.notQualified} />
              <Stat label="Consultations booked" value={m.consultationsBooked} sub="marked by designers" />
            </div>
          </div>
          <Funnel m={m} />
        </section>

        <section className="card p-5">
          <div className="mb-1 font-semibold">Money</div>
          <div className="mb-4 text-[12px] text-muted">The pipeline is an estimate from pricing.md&apos;s indicative ranges for qualified enquiries. It is not revenue and not a quote. Revenue only counts projects a person has marked as won.</div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            <Stat
              label="Estimated pipeline"
              value={m.pipelinePriced ? `${fmtLakh(m.pipelineMinInr)}–${fmtLakh(m.pipelineMaxInr).replace("₹", "")}` : "—"}
              sub={`${m.pipelinePriced} priced${m.pipelineUnpriced ? ` · ${m.pipelineUnpriced} qualified not priceable` : ""}`}
              def={METRIC_DEFINITIONS.pipeline}
            />
            <Stat label="AI operating cost" value={fmtInr(m.aiCostInr)} sub={`${m.totalMinutes} billed min @ ₹${data.settings.vaaniRatePerMinInr + data.settings.telephonyPerMinInr}/min (assumed)`} def={METRIC_DEFINITIONS.aiCost} />
            <Stat label="Cost per enquiry" value={m.costPerEnquiryInr != null ? fmtInr(m.costPerEnquiryInr) : "—"} def={METRIC_DEFINITIONS.costPerEnquiry} />
            <Stat label="Cost per qualified enquiry" value={m.costPerQualifiedInr != null ? fmtInr(m.costPerQualifiedInr) : "—"} def={METRIC_DEFINITIONS.costPerQualified} />
            <Stat
              label="Won projects (recorded)"
              value={m.won ? fmtLakh(m.wonValueInr) : "—"}
              sub={m.outcomesRecorded ? `${m.won} won · conversion ${pct(m.conversionRate)}` : "No outcomes recorded yet"}
              def={METRIC_DEFINITIONS.conversion}
            />
          </div>
        </section>

        {/* Call log */}
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
            <div className="mr-2 font-semibold">Call log</div>
            {(
              [
                ["all", "All"],
                ["QUALIFIED", "Qualified"],
                ["NEEDS_REVIEW", "Needs review"],
                ["NOT_QUALIFIED", "Not qualified"],
                ["pending", "Handoff pending"],
                ["missed", "Missed"],
                ["after", "After hours"],
              ] as [Filter, string][]
            ).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={cls("rounded-full border px-2.5 py-0.5 text-[12px] font-semibold", filter === k ? "border-ink bg-ink text-white" : "border-line text-ink-2 hover:bg-line-2")}>
                {l}
              </button>
            ))}
            <span className="ml-auto text-[12px] text-muted">{rows.length} calls</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-[13px]">
              <thead className="bg-line-2/60 text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  {["Time", "Caller", "Phone", "Project", "Location", "Qualification", "Indicative value", "Duration", "AI cost", "Handoff"].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} onClick={() => setOpen(e.id)} className={cls("cursor-pointer border-t border-line-2 hover:bg-paper", e.supersededBy && "opacity-55")}>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="num">{fmtTime(e.createdAt)}</div>
                      <div className="text-[11px] text-muted">
                        {sourceLabel(e.source)}
                        {e.afterHours && " · after hours"}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{e.callerName ?? <span className="text-muted">Unknown</span>}</div>
                      {e.supersededBy && <div className="text-[11px] text-muted">continued in a later call</div>}
                      {e.flags.filter((f) => f !== "After hours").slice(0, 1).map((f) => (
                        <div key={f} className="text-[11px] text-brand">
                          {f}
                        </div>
                      ))}
                    </td>
                    <td className="num px-3 py-2.5 whitespace-nowrap text-ink-2">{e.phone ?? (e.source === "replay" ? "Anonymised" : "—")}</td>
                    <td className="px-3 py-2.5">{projectLabel(e)}</td>
                    <td className="px-3 py-2.5">{e.location?.split(",")[0] ?? <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-2.5">
                      <QualBadge e={e} />
                    </td>
                    <td className="num px-3 py-2.5 whitespace-nowrap">
                      {e.pricing.status === "estimated" && e.indicativePriceMin != null ? (
                        <span title={e.pricing.basis}>
                          {fmtLakh(e.indicativePriceMin)}–{e.indicativePriceMax ? fmtLakh(e.indicativePriceMax).replace("₹", "") : "+"}
                        </span>
                      ) : (
                        <span className="text-muted">{e.pricing.status === "designer_quote" ? "Designer quote" : "—"}</span>
                      )}
                    </td>
                    <td className="num px-3 py-2.5">{e.callDurationSeconds ? fmtDur(e.callDurationSeconds) : "—"}</td>
                    <td className="num px-3 py-2.5">{fmtInr(e.aiCost)}</td>
                    <td className="px-3 py-2.5">
                      <HandoffBadge e={e} />
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={10} className="px-3 py-10 text-center text-muted">
                      No calls here yet. <a className="font-semibold text-brand underline" href="/call">Make a test call</a> or load the September replay from Settings.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <footer className="pb-6 text-center text-[12px] text-muted">
          Phone enquiries only. WhatsApp and web form are out of scope for this build. Storage: {it.store === "supabase" ? "Supabase" : "local file"}. Updated {fmtTime(data.generatedAt)}.
        </footer>
      </main>

      {selected && <EnquiryDrawer e={selected} all={data.enquiries} calendlyUrl={it.calendlyUrl} onClose={() => setOpen(null)} onChanged={refresh} onOpen={setOpen} />}
      {settingsOpen && <SettingsPanel data={data} onClose={() => setSettingsOpen(false)} onChanged={refresh} />}
    </>
  );
}

export const projectLabel = (e: Enquiry) => {
  if (e.intent === "existing_client") return "Existing client";
  if (e.callStatus === "missed" || e.callStatus === "failed") return <span className="text-muted">—</span>;
  const t = e.propertyType ?? (e.projectType ? e.projectType.replace("_", " ") : null);
  const scope = e.scope === "full" ? "full" : e.scope === "partial" ? "rooms" : e.scope === "advisory" ? "advice only" : null;
  return t ? (
    <span>
      {t}
      {scope && <span className="text-muted"> · {scope}</span>}
    </span>
  ) : (
    <span className="text-muted">Unclear</span>
  );
};

function Stat({ label, value, sub, def }: { label: string; value: React.ReactNode; sub?: string; def?: string }) {
  return (
    <div title={def}>
      <div className="label">{label}</div>
      <div className="num mt-1 text-[22px] font-bold leading-tight">{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

function Funnel({ m }: { m: ReturnType<typeof computeMetrics> }) {
  const steps: [string, number, string?][] = [
    ["Incoming calls", m.incoming],
    ["Answered", m.answered],
    ["Completed", m.completed],
    ["Qualified", m.qualified],
    ["Designer handoff", m.handoffsSent],
    ["Consultation booked", m.consultationsBooked, "marked by designers"],
    ["Project won", m.won, m.outcomesRecorded ? undefined : "recorded by the studio — none yet"],
  ];
  const max = Math.max(1, m.incoming);
  return (
    <div className="card p-5">
      <div className="mb-3 font-semibold">Funnel</div>
      <div className="space-y-2">
        {steps.map(([l, v, note], i) => (
          <div key={l}>
            <div className="mb-0.5 flex justify-between text-[12px]">
              <span className="text-ink-2">{l}</span>
              <span className="num font-semibold">
                {v}
                {i > 0 && steps[i - 1][1] > 0 && <span className="ml-1.5 font-normal text-muted">{Math.round((v / steps[i - 1][1]) * 100)}%</span>}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-line-2">
              <div className={cls("h-2.5 rounded-full", i >= 5 ? "bg-ok" : i >= 3 ? "bg-brand" : "bg-ink/70")} style={{ width: `${(v / max) * 100}%` }} />
            </div>
            {note && <div className="mt-0.5 text-[11px] text-muted">{note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function AttentionList({ title, tone, items, onOpen }: { title: string; tone: string; items: Enquiry[]; onOpen: (id: string) => void }) {
  return (
    <div className="rounded-xl border border-line-2 bg-paper/60 p-3">
      <div className={cls("mb-1.5 text-[12px] font-bold uppercase tracking-wide", tone)}>
        {title} · {items.length}
      </div>
      {items.length === 0 && <div className="text-[12px] text-muted">Nothing here.</div>}
      {items.slice(0, 5).map((e) => (
        <button key={e.id} onClick={() => onOpen(e.id)} className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-surface">
          <span className="truncate">
            {e.callerName ?? e.phone ?? "Unknown caller"} <span className="text-muted">· {fmtTime(e.createdAt)}</span>
          </span>
          <Badge tone="bg-line-2 text-ink-2">Open</Badge>
        </button>
      ))}
      {items.length > 5 && <div className="px-1.5 text-[12px] text-muted">+{items.length - 5} more</div>}
    </div>
  );
}
