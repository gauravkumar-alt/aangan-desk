"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { startDialogue, step, type DialogueState } from "@/lib/agent/dialogue";
import { isWithinHours } from "@/lib/hours";
import { indicativePrice } from "@/lib/pricing";
import { qualify } from "@/lib/qualify";
import type { Ruleset } from "@/lib/rules/schema";
import type { Enquiry } from "@/lib/types";
import { Badge, cls, fmtInr, fmtLakh, HandoffBadge, Header, QualBadge } from "./ui";

type Phase = "idle" | "ringing" | "live" | "posting" | "done";

interface Scenario {
  id: string;
  name: string;
  lines: string[];
  afterHours?: boolean;
  hangUpEarly?: boolean;
  setup?: { simulateHandoffFailure?: boolean; simulateVaaniApiFailure?: boolean };
  redeliver?: boolean;
}

const QUALIFIED = [
  "Hi, I'm Priya Kulkarni. We have a 3BHK in Kothrud and want to do the whole flat.",
  "About 1,400 square feet carpet.",
  "Yes, we own it. My husband and I, he's happy to go ahead.",
  "We'd like it done by March next year, we're not in a rush.",
  "Yes, this number is fine.",
];

const SCENARIOS: Scenario[] = [
  { id: "q", name: "1 · Qualified home", lines: QUALIFIED },
  { id: "nq", name: "2 · Out of area (Nashik)", lines: ["Hello, I'm Suresh Patil from Nashik. I want to redo my home office and study."] },
  { id: "ah", name: "3 · After hours (10:30pm)", lines: QUALIFIED, afterHours: true },
  { id: "unk", name: "4 · Doesn't know size", lines: ["Hi, I'm Meena. I want to redesign my 2BHK in Baner, the whole home.", "Honestly I don't know the size.", "Yes, it's ours.", "By April next year.", "Yes."] },
  { id: "price", name: "5 · Asks price first", lines: ["Hi, how much do you charge per square foot for a 2BHK?", "It's in Wakad, about 950 square feet, the full home.", "Rahul Joshi.", "Yes, I own it.", "We want it done by February.", "Yes."] },
  { id: "corr", name: "6 · Changes an answer", lines: ["Hi I'm Arjun Rao, we have a 3BHK in Aundh, full home.", "About 1,400 square feet.", "Actually sorry, it's 1,200 square feet, not 1,400.", "Yes, we own it.", "Done by May next year.", "Yes."] },
  { id: "drop", name: "7 · Hangs up early", lines: ["Hi, I wanted to ask about interiors for my"], hangUpEarly: true },
  { id: "tg", name: "8 · Telegram fails", lines: QUALIFIED, setup: { simulateHandoffFailure: true } },
  { id: "vaani", name: "9 · Vaani API fails", lines: QUALIFIED, setup: { simulateVaaniApiFailure: true } },
  { id: "dup", name: "10 · Duplicate webhook", lines: QUALIFIED, redeliver: true },
  { id: "budget", name: "Budget clearly too low", lines: ["Hi, I have a 1BHK in Kharadi. I want to do the kitchen and one bedroom. My budget is 1 to 1.5 lakh maximum."] },
  { id: "esc", name: "Existing client complaint", lines: ["My name is Sheetal Deshpande. My project has been going for three months and my designer hasn't replied in five days."] },
];

const FIELDS: [keyof DialogueState["facts"], string][] = [
  ["callerName", "Name"],
  ["projectType", "Project type"],
  ["propertyType", "Property"],
  ["location", "Location"],
  ["areaSqFt", "Area (sq ft)"],
  ["spaces", "Spaces"],
  ["scope", "Scope"],
  ["projectStage", "Stage"],
  ["ownership", "Ownership"],
  ["decisionMaker", "Decision-maker"],
  ["timeline", "Timeline"],
  ["budget", "Budget (volunteered)"],
  ["referral", "Source"],
];

// Browser speech APIs (Chrome/Edge/Safari). Typed input works everywhere.
type SR = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; abort(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const getSR = (): (new () => SR) | null => (typeof window === "undefined" ? null : ((window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition ?? null));

function afterHoursOffset() {
  // Today 22:30 IST minus now — shifts the call's clock so the after-hours path can be shown any time.
  const now = new Date();
  const ist = new Date(now.getTime() + 330 * 60_000);
  const target = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 22, 30) - 330 * 60_000;
  return target - now.getTime();
}

export function CallSimulator({ rules, demo }: { rules: Ruleset; demo: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [dlg, setDlg] = useState<DialogueState | null>(null);
  const [input, setInput] = useState("");
  const [phone, setPhone] = useState("+91 98220 41736");
  const [voice, setVoice] = useState(true);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [clockOffset, setClockOffset] = useState(0);
  const [, setRingAt] = useState<string | null>(null);
  const [, setAnsweredAt] = useState<string | null>(null);
  const [result, setResult] = useState<{ callId: string; delivery: { status: number; body: { enquiryId?: string; duplicate?: boolean; error?: string }; signature: string | null } } | null>(null);
  const [enquiry, setEnquiry] = useState<Enquiry | null>(null);
  const [dupResult, setDupResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const recRef = useRef<SR | null>(null);
  const dlgRef = useRef<DialogueState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const ringRef = useRef<string | null>(null);
  const answeredRef = useRef<string | null>(null);
  const clock = () => new Date(Date.now() + offsetRef.current);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [dlg?.turns.length, interim]);

  function speak(text: string): Promise<void> {
    if (!voice || typeof window === "undefined" || !window.speechSynthesis) return Promise.resolve();
    return new Promise((resolve) => {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = window.speechSynthesis.getVoices();
      u.voice = v.find((x) => x.lang === "en-IN") ?? v.find((x) => x.lang.startsWith("en-GB")) ?? v.find((x) => x.lang.startsWith("en")) ?? null;
      u.rate = 1.05;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
      setTimeout(resolve, Math.min(20000, 600 + text.length * 70)); // never hang the script on a stuck voice
    });
  }

  async function startCall(offset = 0): Promise<DialogueState> {
    setError(null);
    setResult(null);
    setEnquiry(null);
    setDupResult(null);
    setClockOffset(offset);
    offsetRef.current = offset;
    const ring = new Date(Date.now() + offset);
    ringRef.current = ring.toISOString();
    setRingAt(ringRef.current);
    setPhase("ringing");
    await new Promise((r) => setTimeout(r, 1800));
    const now = new Date(Date.now() + offset);
    answeredRef.current = now.toISOString();
    setAnsweredAt(answeredRef.current);
    const { state, reply } = startDialogue(now, rules);
    setDlg(state);
    dlgRef.current = state;
    setPhase("live");
    await speak(reply);
    return state;
  }

  async function say(text: string, from?: DialogueState): Promise<DialogueState | null> {
    const cur = from ?? dlgRef.current;
    if (!cur || cur.phase === "ended" || !text.trim()) return cur;
    window.speechSynthesis?.cancel(); // barge-in: the caller talking stops the agent
    const r = step(cur, text.trim(), rules, clock());
    setDlg(r.state);
    dlgRef.current = r.state;
    setInput("");
    await speak(r.reply);
    if (r.ended) await finish(r.state, false);
    return r.state;
  }

  async function finish(state: DialogueState, early: boolean) {
    recRef.current?.abort();
    setListening(false);
    window.speechSynthesis?.cancel();
    setPhase("posting");
    const endedAt = clock().toISOString();
    const res = await fetch("/api/demo/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: state.turns,
        facts: state.facts,
        unknown: state.unknown,
        declined: state.declined,
        ringStartedAt: ringRef.current ?? state.startedAt,
        answeredAt: answeredRef.current ?? state.startedAt,
        endedAt,
        phone: phone.replace(/\s/g, ""),
        endedEarly: early,
        repeatCaller: state.repeatCaller,
        altPhone: state.altPhone,
      }),
    });
    const j = await res.json();
    if (!res.ok) {
      setError(j.error ?? "Couldn't deliver the call");
      setPhase("done");
      return null;
    }
    setResult(j);
    setPhase("done");
    const id = j.delivery?.body?.enquiryId as string | undefined;
    if (id) await poll(id);
    return j;
  }

  async function poll(id: string) {
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`/api/enquiries/${id}`, { cache: "no-store" });
      if (r.ok) {
        const e = (await r.json()) as Enquiry;
        setEnquiry(e);
        const settled = e.transcriptStatus !== "pending_fetch" && (e.handoff.status !== "PENDING" || e.handoff.attempts.length > 0);
        if (settled) return e;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  async function hangUp() {
    const s = dlgRef.current;
    if (!s) return;
    const ended = { ...s, phase: "ended" as const, endReason: "caller_left" as const };
    setDlg(ended);
    await finish(ended, true);
  }

  function toggleMic() {
    const SRc = getSR();
    if (!SRc) {
      setError("Speech recognition isn't available in this browser — type instead (Chrome/Edge support the mic).");
      return;
    }
    if (listening) {
      recRef.current?.stop();
      return;
    }
    window.speechSynthesis?.cancel();
    const rec = new SRc();
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        final = final || e.results[i].isFinal;
      }
      setInterim(text);
      if (final) {
        setInterim("");
        void say(text);
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => {
      setListening(false);
      const why: Record<string, string> = {
        "audio-capture": "No microphone sound reaching Chrome. Check System Settings → Privacy & Security → Microphone (allow Chrome) and System Settings → Sound → Input. You can type instead.",
        "not-allowed": "Microphone blocked for this site. Click the ⓘ next to the address bar → Microphone → Allow, then reload. You can type instead.",
        network: "Chrome's speech service couldn't be reached (it needs internet). You can type instead.",
      };
      if (e.error !== "no-speech" && e.error !== "aborted") setError(why[e.error] ?? `Microphone error (${e.error}). You can type instead.`);
    };
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  async function runScenario(sc: Scenario) {
    if (running) return;
    setRunning(sc.id);
    try {
      if (sc.setup) await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sc.setup) });
      let s: DialogueState | null = await startCall(sc.afterHours ? afterHoursOffset() : 0);
      for (const line of sc.lines) {
        if (!s || s.phase === "ended") break;
        await new Promise((r) => setTimeout(r, 500));
        setInput(line);
        await new Promise((r) => setTimeout(r, 350));
        s = await say(line, s);
      }
      if (sc.hangUpEarly && s && s.phase !== "ended") await hangUp();
    } finally {
      if (sc.setup) {
        const reset = Object.fromEntries(Object.keys(sc.setup).map((k) => [k, false]));
        await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reset) });
      }
      setRunning(null);
    }
    if (sc.redeliver) setTimeout(() => void redeliver(), 600);
  }

  async function redeliver(callId = result?.callId) {
    const id = callId ?? (document.querySelector("[data-call-id]") as HTMLElement | null)?.dataset.callId;
    if (!id) return;
    const r = await fetch("/api/demo/redeliver", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callId: id }) });
    const j = await r.json();
    setDupResult(r.ok ? `HTTP ${j.status} · ${j.body?.duplicate ? "duplicate detected — not processed again" : JSON.stringify(j.body)}` : j.error);
  }

  // Live view of what the AI would decide right now.
  const live = useMemo(() => {
    if (!dlg) return null;
    const now = clock();
    const pricing = indicativePrice(dlg.facts, rules);
    const q = qualify(dlg.facts, rules, { now, callStatus: "completed", afterHours: !isWithinHours(now, rules.services.rules?.hours), pricing, repeatCaller: dlg.repeatCaller, unknownFields: dlg.unknown, declinedFields: dlg.declined });
    return { pricing, q };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dlg, rules, clockOffset]);

  const afterHoursNow = !isWithinHours(clock(), rules.services.rules?.hours);

  return (
    <>
      <Header active="call" />
      <main className="mx-auto grid max-w-[1280px] gap-5 px-4 py-5 lg:grid-cols-[420px_1fr]">
        {/* Phone */}
        <section className="space-y-4">
          <div className="card flex h-[640px] flex-col overflow-hidden">
            <div className="border-b border-line bg-surface px-4 py-3 text-ink">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-wide opacity-60">{phase === "idle" ? "Ready" : phase === "ringing" ? "Ringing…" : phase === "live" ? "On call" : phase === "posting" ? "Saving…" : "Call ended"}</div>
                  <div className="font-semibold">Aangan Studio front desk</div>
                </div>
                {afterHoursNow && phase !== "idle" && <Badge tone="bg-warn-soft text-warn">AFTER HOURS</Badge>}
              </div>
            </div>
            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-paper p-3">
              {phase === "idle" && (
                <div className="grid h-full place-items-center text-center text-[13px] text-muted">
                  <div>
                    <div className="mb-3">Call the AI front desk as a customer would.</div>
                    <label className="mb-3 block text-left text-[12px]">
                      Your caller number
                      <input className="input mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </label>
                    <button className="btn btn-brand ringing rounded-full px-6 py-3 text-[15px]" onClick={() => void startCall(0)}>
                      📞 Call Aangan
                    </button>
                    <div className="mt-3 text-[11px]">Or pick a scenario on the right — it plays the caller for you.</div>
                  </div>
                </div>
              )}
              {phase === "ringing" && (
                <div className="grid h-full place-items-center">
                  <div className="ringing grid h-20 w-20 place-items-center rounded-full bg-brand text-3xl text-white">📞</div>
                </div>
              )}
              {dlg?.turns.map((t, i) => (
                <div key={i} className={cls("fade-in flex", t.role === "AGENT" ? "justify-start" : "justify-end")}>
                  <div className={cls("max-w-[88%] rounded-2xl px-3 py-2 text-[13px]", t.role === "AGENT" ? "border border-line bg-surface" : "bg-ink text-paper")}>{t.text}</div>
                </div>
              ))}
              {interim && (
                <div className="flex justify-end">
                  <div className="max-w-[88%] rounded-2xl bg-ink/40 px-3 py-2 text-[13px] text-paper italic">{interim}…</div>
                </div>
              )}
            </div>
            {phase === "live" && (
              <form
                className="flex gap-2 border-t border-line bg-surface p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void say(input);
                }}
              >
                <button type="button" onClick={toggleMic} className={cls("btn shrink-0", listening && "border-bad bg-bad-soft text-bad")} title="Speak (barge-in stops the agent)">
                  {listening ? "● Listening" : "🎙"}
                </button>
                <input className="input" placeholder="Say something as the caller…" value={input} onChange={(e) => setInput(e.target.value)} disabled={!!running} />
                <button className="btn btn-primary shrink-0" disabled={!input.trim() || !!running}>
                  Send
                </button>
                <button type="button" className="btn shrink-0 border-bad text-bad" onClick={() => void hangUp()}>
                  Hang up
                </button>
              </form>
            )}
            {phase === "done" && (
              <div className="border-t border-line bg-surface p-3">
                <button className="btn btn-brand w-full justify-center" onClick={() => setPhase("idle")}>
                  New call
                </button>
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Speak the agent&apos;s replies aloud
          </label>
          {!demo && <div className="text-[12px] text-bad">Demo mode is off — the simulator can't post calls.</div>}
        </section>

        {/* Right side */}
        <section className="space-y-4">
          <div className="card p-4">
            <div className="mb-2 font-semibold">Test scenarios</div>
            <div className="flex flex-wrap gap-2">
              {SCENARIOS.map((sc) => (
                <button key={sc.id} className={cls("btn", running === sc.id && "border-brand bg-brand-soft")} disabled={!!running || phase === "live" || phase === "ringing" || phase === "posting"} onClick={() => void runScenario(sc)}>
                  {running === sc.id ? "Playing…" : sc.name}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[12px] text-muted">Each scenario plays the caller through the same conversation engine, then delivers a signed Vaani-format webhook to this app.</div>
          </div>

          {error && <div className="card border-bad/30 bg-bad-soft p-3 text-[13px] text-bad">{error}</div>}

          {dlg && live && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="card p-4">
                <div className="mb-2 font-semibold">What the agent has captured</div>
                <div className="space-y-1 text-[13px]">
                  {FIELDS.map(([k, l]) => {
                    const v = dlg.facts[k];
                    const shown = Array.isArray(v) ? v.join(", ") || null : v == null ? null : String(v);
                    const unk = dlg.unknown.includes(k as string);
                    const dec = dlg.declined.includes(k as string);
                    return (
                      <div key={k} className="flex gap-2">
                        <span className="w-32 shrink-0 text-muted">{l}</span>
                        <span className={cls(!shown && "text-muted")}>{shown ?? (unk ? "Caller didn't know" : dec ? "Preferred not to say" : "—")}</span>
                      </div>
                    );
                  })}
                </div>
                {dlg.corrections.length > 0 && <div className="mt-2 text-[12px] text-brand">Corrections: {dlg.corrections.map((c) => `${String(c.field)} ${c.from} → ${c.to}`).join("; ")}</div>}
              </div>
              <div className="card p-4">
                <div className="mb-2 flex items-center gap-2 font-semibold">
                  Live qualification <QualBadge e={{ qualificationStatus: live.q.status, intent: dlg.facts.intent, callStatus: "completed" }} />
                </div>
                <div className="space-y-1.5 text-[12px]">
                  {live.q.checks.map((c, i) => (
                    <div key={i} className="flex gap-2">
                      <Badge tone={c.outcome === "PASS" ? "bg-ok-soft text-ok" : c.outcome === "NOT_QUALIFIED" ? "bg-bad-soft text-bad" : c.outcome === "INFO" ? "bg-line-2 text-ink-2" : "bg-warn-soft text-warn"}>{c.outcome === "NOT_QUALIFIED" ? "FAIL" : c.outcome.replace("_", " ")}</Badge>
                      <span>
                        <b>{c.criterion ?? c.ruleId}</b> — {c.message}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-lg bg-info-soft p-2 text-[12px] text-info">
                  <b>Internal indicative price:</b>{" "}
                  {live.pricing.status === "estimated" && live.pricing.minInr != null ? `${fmtLakh(live.pricing.minInr)}–${live.pricing.maxInr ? fmtLakh(live.pricing.maxInr).replace("₹", "") : "+"}` : live.pricing.basis}
                  <div className="opacity-80">Never spoken to the caller (pricing.md). Goes to the designer and the pipeline estimate.</div>
                </div>
              </div>
            </div>
          )}

          {(phase === "posting" || result) && (
            <div className="card p-4 text-[13px]" data-call-id={result?.callId}>
              <div className="mb-2 font-semibold">What happened after the call</div>
              {phase === "posting" && <div className="text-muted">Delivering the webhook…</div>}
              {result && (
                <ol className="space-y-2">
                  <Step ok={result.delivery.status === 200} title={result.delivery.status === 200 ? "Call received by Aangan" : `Call couldn’t be received (error ${result.delivery.status})`}>
                    <details className="text-[12px] text-muted">
                      <summary className="cursor-pointer">technical details</summary>
                      Call <code>{result.callId}</code> · webhook HTTP {result.delivery.status} · authenticated: <span className="break-all">{result.delivery.signature?.startsWith("sha256=") ? `${result.delivery.signature.slice(0, 22)}… (HMAC-SHA256)` : result.delivery.signature}</span>
                    </details>
                  </Step>
                  {enquiry && (
                    <>
                      <Step ok title="Saved to the dashboard">
                        <a className="font-semibold text-brand underline" href={`/?enquiry=${enquiry.id}`}>
                          Open in dashboard →
                        </a>
                      </Step>
                      <Step ok={enquiry.transcriptStatus === "complete"} warn={enquiry.transcriptStatus === "pending_fetch"} title={enquiry.transcriptStatus === "complete" ? "Conversation transcript saved" : enquiry.transcriptStatus === "fetch_failed" ? "Transcript not available yet" : "Fetching the transcript…"}>
                        {enquiry.transcriptStatus === "fetch_failed" ? "Fetch failed — the enquiry was qualified from the webhook's extracted entities and can be re-fetched later." : "From the webhook, or the call-details API when it lagged"}
                      </Step>
                      <Step ok title="Result">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <QualBadge e={enquiry} /> {enquiry.qualificationReason}
                        </span>
                      </Step>
                      <Step ok={enquiry.handoff.status !== "PENDING"} warn={enquiry.handoff.status === "PENDING"} title="Designer">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <HandoffBadge e={enquiry} />
                          {enquiry.handoff.status === "NOT_REQUIRED" && <span className="text-muted">Not forwarded.</span>}
                        </span>
                      </Step>
                      <Step ok title={`This call cost about ${fmtInr(enquiry.aiCost)}`}>
                        {enquiry.cost.note}
                      </Step>
                    </>
                  )}
                </ol>
              )}
              {result && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <button className="btn" onClick={() => void redeliver()}>
                    Re-deliver the same webhook
                  </button>
                  {dupResult && <span className="text-[12px] text-ok">{dupResult}</span>}
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function Step({ ok, warn, title, children }: { ok: boolean; warn?: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className={cls("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] text-paper", warn ? "bg-warn" : ok ? "bg-ok" : "bg-bad")}>{warn ? "!" : ok ? "✓" : "×"}</span>
      <div>
        <div className="font-semibold">{title}</div>
        {children && <div className="text-ink-2">{children}</div>}
      </div>
    </li>
  );
}
