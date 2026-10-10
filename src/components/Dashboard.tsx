"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { DashboardData } from "@/lib/dashboard";
import { computeMetrics, METRIC_DEFINITIONS } from "@/lib/metrics";
import { EnquiryDrawer } from "./EnquiryDrawer";
import { RoomScene } from "./RoomScene";
import { SettingsPanel } from "./SettingsPanel";
import { TrendChart } from "./TrendChart";
import { canAnimate, finishAfter } from "./motion";
import { cls, fmtDur, fmtInr, fmtLakh, fmtTime, HandoffBadge, Header, pct, projectText, QualBadge, sourceLabel } from "./ui";

gsap.registerPlugin(useGSAP);

type Source = "all" | "live" | "replay";
type Filter = "all" | "QUALIFIED" | "NEEDS_REVIEW" | "NOT_QUALIFIED" | "pending" | "missed" | "after";

const intFmt = (n: number) => Math.round(n).toLocaleString("en-IN");

/** Number that counts up when it first appears or changes. */
function CountUp({ value, format = intFmt }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(0);
  const fmt = useRef(format);
  fmt.current = format;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!canAnimate()) {
      el.textContent = fmt.current(value);
      last.current = value;
      return;
    }
    const o = { v: last.current };
    const t = gsap.to(o, { v: value, duration: 1.2, ease: "power3.out", onUpdate: () => (el.textContent = fmt.current(o.v)) });
    last.current = value;
    return () => {
      t.kill();
    };
  }, [value]);
  return <span ref={ref}>{format(value)}</span>;
}

export function Dashboard({ initial, openId }: { initial: DashboardData; openId?: string }) {
  const [data, setData] = useState(initial);
  const [source, setSource] = useState<Source>("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(openId ?? null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/dashboard", { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, []);
  useEffect(() => {
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useGSAP(
    () => {
      if (!canAnimate()) return;
      const tl = gsap.from("[data-reveal]", { opacity: 0, y: 24, duration: 0.9, ease: "power3.out", stagger: 0.08, delay: 0.1 });
      return finishAfter(tl);
    },
    { scope: root },
  );

  const scoped = useMemo(() => data.enquiries.filter((e) => (source === "all" ? true : source === "replay" ? e.source === "replay" : e.source !== "replay")), [data.enquiries, source]);
  const m = useMemo(() => computeMetrics(scoped), [scoped]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped.filter((e) => {
      if (q && ![e.callerName, e.phone, e.location, projectText(e)].some((v) => v?.toLowerCase().includes(q))) return false;
      if (filter === "all") return true;
      if (filter === "pending") return e.handoff.status === "PENDING";
      if (filter === "missed") return e.callStatus === "missed" || e.callStatus === "failed";
      if (filter === "after") return e.afterHours;
      return e.qualificationStatus === filter && e.intent !== "existing_client" && !e.supersededBy;
    });
  }, [scoped, filter, query]);
  const reviewQueue = scoped.filter((e) => e.qualificationStatus === "NEEDS_REVIEW" && !e.supersededBy && e.intent !== "existing_client" && e.callStatus !== "missed");
  const pending = scoped.filter((e) => e.handoff.status === "PENDING" || e.crm?.status === "PENDING");
  const attention = [
    { title: "Call back", tone: "text-bad", dot: "bg-bad", items: m.callbacksNeeded },
    { title: "Handoff or CRM pending", tone: "text-warn", dot: "bg-warn", items: pending },
    { title: "Needs review", tone: "text-warn", dot: "bg-warn", items: reviewQueue },
  ].filter((g) => g.items.length);
  const selected = data.enquiries.find((e) => e.id === open) ?? null;
  const it = data.integrations;
  const within5 = m.incoming ? m.answeredWithin5 / m.incoming : null;
  const latest = useMemo(() => {
    const seen = new Set<string>();
    return [...scoped]
      .filter((e) => e.callStatus !== "missed" && !e.supersededBy && e.callerName)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter((e) => {
        const k = (e.callerName ?? "").toLowerCase(); // one card per person
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 3);
  }, [scoped]);
  const now = new Date();
  const istHour = new Date(now.getTime() + 330 * 60_000).getUTCHours();
  const greeting = istHour < 12 ? "Good morning, Nikhil" : istHour < 17 ? "Good afternoon, Nikhil" : "Good evening, Nikhil";

  async function retryAll() {
    setBusy(true);
    try {
      await fetch("/api/handoffs/retry", { method: "POST" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={root}>
      <Header
        active="dashboard"
        status={{ vaani: it.vaani, handoff: it.handoff, crm: it.crm, store: it.store, rulesOk: !data.rules.warnings.length }}
        right={
          <button className="btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
            Settings
          </button>
        }
      />
      <main className="mx-auto max-w-[1320px] space-y-6 px-4 pb-12 md:px-6">
        {data.rules.warnings.length > 0 && <div className="card mt-4 p-3 text-[13px] text-bad">{data.rules.warnings.join(" · ")}</div>}

        {/* ── HERO: the two founder questions + the living room ── */}
        <section className="blueprint relative mt-4 overflow-hidden rounded-[28px] border border-white/[0.06] px-5 pt-7 pb-4 md:px-9 md:pt-10">
          <div className="grid items-center gap-6 lg:grid-cols-[1.05fr_1fr]">
            <div data-reveal>
              <div className="label flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-brand breathe" /> {greeting} · {now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })}
              </div>
              <h1 className="font-display mt-3 text-[40px] leading-[1.02] sm:text-[48px] xl:text-[60px]">
                Every call, <em className="whitespace-nowrap text-brand">answered.</em>
                <br />
                The right ones, <em className="whitespace-nowrap text-brass">handed over.</em>
              </h1>
              <div className="mt-7 grid grid-cols-2 gap-4 md:max-w-[560px]">
                <div className="card p-4 md:p-5" title={METRIC_DEFINITIONS.answeredWithin5}>
                  <div className="label">Answered within 5 min</div>
                  <div className="font-display mt-1 text-[48px] leading-none md:text-[60px]">
                    {within5 == null ? "—" : <CountUp value={within5 * 100} format={(n) => `${Math.round(n)}%`} />}
                  </div>
                  <div className="mt-2 text-[12.5px] text-ink-2">
                    of {m.incoming} calls{m.medianAnswerSec != null && <> · picked up in ~{m.medianAnswerSec}s</>}
                  </div>
                </div>
                <div className="card p-4 md:p-5">
                  <div className="label">Qualified → designer</div>
                  <div className="font-display mt-1 text-[48px] leading-none md:text-[60px]">
                    <CountUp value={m.handoffsSent} />
                    <span className="text-[28px] text-muted md:text-[34px]">/{m.qualified}</span>
                  </div>
                  <div className="mt-2 text-[12.5px] text-ink-2">{m.medianHandoffSec != null ? <>briefed ~{Math.round(m.medianHandoffSec)}s after the call</> : <>with everything already asked</>}</div>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ink-2">
                <span><b className="num text-ink">{m.afterHours}</b> after hours ({pct(m.incoming ? m.afterHours / m.incoming : null)})</span>
                <span><b className="num text-ink">{m.notQualified}</b> closed politely</span>
                <span><b className="num text-ink">{m.needsReview}</b> to review</span>
                {m.escalations > 0 && <span><b className="num text-ink">{m.escalations}</b> client escalation</span>}
              </div>
            </div>
            <div data-reveal className="relative -mx-2 lg:mx-0">
              <RoomScene latest={latest} />
            </div>
          </div>
          <div data-reveal className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
            <div className="flex rounded-full border border-white/[0.08] bg-black/20 p-1">
              {(
                [
                  ["all", "All calls"],
                  ["live", "Live & test"],
                  ["replay", "Sep 2026 replay"],
                ] as [Source, string][]
              ).map(([k, l]) => (
                <button key={k} onClick={() => setSource(k)} className={cls("rounded-full px-3.5 py-1 text-[12.5px] font-medium transition", source === k ? "bg-ink text-paper" : "text-ink-2 hover:text-ink")}>
                  {l}
                </button>
              ))}
            </div>
            {source !== "live" && <span className="text-[12px] text-muted">Replay = September&apos;s 20 real phone transcripts run through this system · pickup times simulated</span>}
          </div>
        </section>

        {/* ── MONEY STRIP ── */}
        <section data-reveal className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Estimated pipeline" hint={METRIC_DEFINITIONS.pipeline} accent>
            {m.pipelinePriced ? (
              <>
                <CountUp value={m.pipelineMinInr} format={(n) => fmtLakh(n)} />
                <span className="text-muted">–</span>
                <CountUp value={m.pipelineMaxInr} format={(n) => fmtLakh(n).replace("₹", "")} />
              </>
            ) : (
              "—"
            )}
            <Sub>{m.pipelinePriced} priced · estimate, not revenue</Sub>
          </Tile>
          <Tile label="AI operating cost" hint={METRIC_DEFINITIONS.aiCost}>
            <CountUp value={m.aiCostInr} format={(n) => fmtInr(Math.round(n))} />
            <Sub>{m.totalMinutes} min · ₹{data.settings.vaaniRatePerMinInr + data.settings.telephonyPerMinInr}/min</Sub>
          </Tile>
          <Tile label="Cost per qualified lead" hint={METRIC_DEFINITIONS.costPerQualified}>
            {m.costPerQualifiedInr != null ? <CountUp value={m.costPerQualifiedInr} format={(n) => fmtInr(Math.round(n))} /> : "—"}
            <Sub>{m.costPerEnquiryInr != null ? `${fmtInr(Math.round(m.costPerEnquiryInr))} per enquiry` : "no enquiries yet"}</Sub>
          </Tile>
          <Tile label="Won projects" hint={METRIC_DEFINITIONS.conversion}>
            {m.won ? <CountUp value={m.wonValueInr} format={(n) => fmtLakh(n)} /> : <span className="text-muted">—</span>}
            <Sub>{m.outcomesRecorded ? `${m.won} won · ${pct(m.conversionRate)} conversion` : `${m.consultationsBooked} consultations booked · no outcomes yet`}</Sub>
          </Tile>
        </section>

        {/* ── TREND + FUNNEL ── */}
        <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <div data-reveal className="card p-5 md:p-6">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-display text-[26px] leading-none">Last 7 days</h2>
              <span className="label">calls per day</span>
            </div>
            <TrendChart enquiries={scoped} />
          </div>
          <div data-reveal className="card p-5 md:p-6">
            <h2 className="font-display mb-4 text-[26px] leading-none">From ring to project</h2>
            <Funnel m={m} />
          </div>
        </section>

        {/* ── NEEDS YOU (only groups that have something) ── */}
        {attention.length > 0 && (
          <section data-reveal className="card p-5 md:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-[26px] leading-none">Needs you</h2>
              {pending.length > 0 && (
                <button className="btn btn-brand" disabled={busy} onClick={retryAll}>
                  {busy ? "Retrying…" : "Retry pending"}
                </button>
              )}
            </div>
            <div className={cls("grid gap-3", attention.length > 1 && "md:grid-cols-2", attention.length > 2 && "lg:grid-cols-3")}>
              {attention.map((g) => (
                <div key={g.title} className="rounded-2xl border border-white/[0.06] bg-black/20 p-3">
                  <div className={cls("mb-2 flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] uppercase", g.tone)}>
                    <span className={cls("h-1.5 w-1.5 rounded-full", g.dot)} /> {g.title} · {g.items.length}
                  </div>
                  {g.items.slice(0, 4).map((e) => (
                    <button key={e.id} onClick={() => setOpen(e.id)} className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-left text-[13px] transition hover:bg-white/5">
                      <span className="truncate">{e.callerName ?? e.phone ?? "Unknown number"}</span>
                      <span className="shrink-0 text-[11.5px] text-muted">{fmtTime(e.createdAt)}</span>
                    </button>
                  ))}
                  {g.items.length > 4 && <div className="px-2 pt-1 text-[12px] text-muted">+{g.items.length - 4} more</div>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── CALL LOG ── */}
        <section data-reveal className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-4 md:p-5">
            <h2 className="font-display mr-2 text-[26px] leading-none">Call log</h2>
            <input className="input !w-full !rounded-full !py-1.5 md:!w-60" placeholder="Search name, number, place…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["all", "All"],
                  ["QUALIFIED", "Qualified"],
                  ["NEEDS_REVIEW", "Review"],
                  ["NOT_QUALIFIED", "Not a fit"],
                  ["pending", "Pending"],
                  ["missed", "Missed"],
                  ["after", "After hours"],
                ] as [Filter, string][]
              ).map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)} className={cls("rounded-full border px-3 py-1 text-[12px] font-medium transition", filter === k ? "border-ink bg-ink text-paper" : "border-white/[0.1] text-ink-2 hover:border-white/25 hover:text-ink")}>
                  {l}
                </button>
              ))}
            </div>
            <span className="ml-auto text-[12px] text-muted">{rows.length} calls</span>
          </div>

          <div className="hidden md:block">
            <div className="grid grid-cols-[118px_minmax(170px,1.4fr)_minmax(140px,1.2fr)_104px_118px_104px_84px_118px] gap-3 border-b border-white/[0.05] px-5 py-2.5 text-[10.5px] font-semibold tracking-[0.12em] text-muted uppercase">
              <span>Time</span>
              <span>Caller</span>
              <span>Project</span>
              <span>Location</span>
              <span>Status</span>
              <span>Indicative</span>
              <span>Call · AI</span>
              <span>Handoff</span>
            </div>
            {rows.map((e) => (
              <button
                key={e.id}
                onClick={() => setOpen(e.id)}
                className={cls("grid w-full grid-cols-[118px_minmax(170px,1.4fr)_minmax(140px,1.2fr)_104px_118px_104px_84px_118px] items-center gap-3 border-b border-white/[0.04] px-5 py-3 text-left text-[13px] transition hover:bg-white/[0.03]", e.supersededBy && "opacity-45")}
              >
                <span className="min-w-0">
                  <span className="num block">{fmtTime(e.createdAt)}</span>
                  <span className="block truncate text-[11px] text-muted">{sourceLabel(e.source)}{e.afterHours ? " · after hrs" : ""}</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{e.callerName ?? (e.phone ? "Caller" : "Unknown caller")}</span>
                  <span className="block truncate font-mono text-[11.5px] text-muted">{e.phone ?? (e.source === "replay" ? "anonymised" : "—")}</span>
                </span>
                <span className="min-w-0 truncate text-ink-2">{projectText(e) ?? <span className="text-muted">—</span>}</span>
                <span className="truncate text-ink-2">{e.location?.split(",")[0] ?? <span className="text-muted">—</span>}</span>
                <span><QualBadge e={e} /></span>
                <span className="num truncate text-ink-2">
                  {e.pricing.status === "estimated" && e.indicativePriceMin != null ? `${fmtLakh(e.indicativePriceMin)}–${e.indicativePriceMax ? fmtLakh(e.indicativePriceMax).replace("₹", "") : "+"}` : <span className="text-muted">{e.pricing.status === "designer_quote" ? "designer" : "—"}</span>}
                </span>
                <span className="num text-[12px] text-ink-2">
                  {e.callDurationSeconds ? fmtDur(e.callDurationSeconds) : "—"}
                  <span className="block text-muted">{fmtInr(Math.round(e.aiCost))}</span>
                </span>
                <span><HandoffBadge e={e} compact /></span>
              </button>
            ))}
          </div>

          <div className="divide-y divide-white/[0.05] md:hidden">
            {rows.map((e) => (
              <button key={e.id} onClick={() => setOpen(e.id)} className={cls("block w-full p-4 text-left", e.supersededBy && "opacity-45")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{e.callerName ?? e.phone ?? "Unknown caller"}</span>
                  <QualBadge e={e} />
                </div>
                <div className="mt-1 truncate text-[13px] text-ink-2">{[projectText(e), e.location?.split(",")[0]].filter(Boolean).join(" · ") || "—"}</div>
                <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-muted">
                  <span>{fmtTime(e.createdAt)} · {sourceLabel(e.source)}</span>
                  <HandoffBadge e={e} compact />
                </div>
              </button>
            ))}
          </div>
          {!rows.length && (
            <div className="px-5 py-14 text-center text-muted">
              Nothing here yet. <a className="font-medium text-brand underline-offset-4 hover:underline" href="/call">Make a test call</a>.
            </div>
          )}
        </section>

        <footer className="pt-2 text-center text-[12px] text-muted">Phone enquiries only · WhatsApp and web form out of scope · updated {fmtTime(data.generatedAt)}</footer>
      </main>

      {selected && <EnquiryDrawer e={selected} all={data.enquiries} calendlyUrl={it.calendlyUrl} onClose={() => setOpen(null)} onChanged={refresh} onOpen={setOpen} />}
      {settingsOpen && <SettingsPanel data={data} onClose={() => setSettingsOpen(false)} onChanged={refresh} />}
    </div>
  );
}

function Tile({ label, hint, accent, children }: { label: string; hint?: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div className={cls("card p-4 md:p-5", accent && "card-glow")} title={hint}>
      <div className="label">{label}</div>
      <div className="font-display mt-2 flex flex-wrap items-baseline gap-x-1 text-[30px] leading-none md:text-[36px]">{children}</div>
    </div>
  );
}
const Sub = ({ children }: { children: React.ReactNode }) => <div className="mt-2 w-full font-sans text-[12px] leading-snug text-muted">{children}</div>;

function Funnel({ m }: { m: ReturnType<typeof computeMetrics> }) {
  const steps: [string, number][] = [
    ["Incoming calls", m.incoming],
    ["Answered", m.answered],
    ["Completed", m.completed],
    ["Qualified", m.qualified],
    ["Designer handoff", m.handoffsSent],
    ["Consultation booked", m.consultationsBooked],
    ["Project won", m.won],
  ];
  const max = Math.max(1, m.incoming);
  return (
    <div className="space-y-2.5">
      {steps.map(([l, v], i) => (
        <div key={l}>
          <div className="mb-1 flex justify-between text-[12.5px]">
            <span className="text-ink-2">{l}</span>
            <span className="num">
              {v}
              {i > 0 && steps[i - 1][1] > 0 && <span className="ml-1.5 text-muted">{Math.round((v / steps[i - 1][1]) * 100)}%</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
            <div
              className="h-2 rounded-full transition-[width] duration-1000"
              style={{ width: `${(v / max) * 100}%`, background: i < 3 ? "linear-gradient(90deg,#6d6253,#c9bfb1)" : i < 5 ? "linear-gradient(90deg,#9c4322,#e0784a)" : "linear-gradient(90deg,#4f6b4d,#9cc49a)" }}
            />
          </div>
        </div>
      ))}
      <div className="pt-1 text-[11.5px] text-muted">Bookings and wins are entered by the studio — never assumed.</div>
    </div>
  );
}
