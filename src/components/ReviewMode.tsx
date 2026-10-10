"use client";
import { useCallback, useEffect, useState } from "react";
import type { Enquiry } from "@/lib/types";
import { cls, fmtTime, projectText } from "./ui";

// Front-desk review, one enquiry at a time: why it needs a person, the facts, and three big choices.
// Keys: S = send to designer · N = not a fit · → = skip · Esc = leave.

export function ReviewMode({ queue, onDone, onOpenFull }: { queue: Enquiry[]; onDone: () => void; onOpenFull: (id: string) => void }) {
  const [list] = useState(queue); // snapshot: the queue doesn't reshuffle while you work
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ sent: number; closed: number; skipped: number }>({ sent: 0, closed: 0, skipped: 0 });
  const e = list[i];

  const next = useCallback(() => setI((x) => x + 1), []);
  const decide = useCallback(
    async (decision: "approved" | "closed") => {
      if (!e || busy) return;
      setBusy(true);
      try {
        await fetch(`/api/enquiries/${e.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ review: { decision, note: "Checked in review mode" } }) });
        setDone((d) => (decision === "approved" ? { ...d, sent: d.sent + 1 } : { ...d, closed: d.closed + 1 }));
        next();
      } finally {
        setBusy(false);
      }
    },
    [e, busy, next],
  );
  const skip = useCallback(() => {
    setDone((d) => ({ ...d, skipped: d.skipped + 1 }));
    next();
  }, [next]);

  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement) return;
      if (ev.key === "Escape") onDone();
      else if (!e) return;
      else if (ev.key === "s" || ev.key === "S") decide("approved");
      else if (ev.key === "n" || ev.key === "N") decide("closed");
      else if (ev.key === "ArrowRight") skip();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [e, decide, skip, onDone]);

  const why = e?.checks.filter((c) => c.outcome === "NEEDS_REVIEW") ?? [];
  const facts: [string, string | null][] = e
    ? [
        ["Project", projectText(e)],
        ["Where", e.location?.split(",")[0] ?? null],
        ["Size", e.areaSqFt ? `${e.areaSqFt.toLocaleString("en-IN")} sq ft` : null],
        ["When", e.timeline],
        ["Budget (they said)", e.budget],
        ["Best time to call", e.callbackPreference],
      ]
    : [];
  const lastCaller = e?.transcript.filter((t) => t.role === "CALLER").slice(-2).map((t) => t.text) ?? [];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Check enquiries one by one">
      <div className="card fade-in w-full max-w-[640px] !bg-surface p-6 md:p-8">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="label">
            Checking {Math.min(i + 1, list.length)} of {list.length}
          </div>
          <button className="btn" onClick={onDone}>
            Done
          </button>
        </div>
        <div className="mb-6 h-1 overflow-hidden rounded-full bg-ink/10">
          <div className="h-1 rounded-full bg-brand transition-[width] duration-500" style={{ width: `${(Math.min(i, list.length) / list.length) * 100}%` }} />
        </div>

        {e ? (
          <>
            <h2 className="font-display text-[34px] leading-tight">{e.callerName ?? e.phone ?? "Unknown caller"}</h2>
            <div className="mt-1 text-[13px] text-muted">
              {fmtTime(e.createdAt)}
              {e.phone && <span className="font-mono"> · {e.phone}</span>}
            </div>

            <div className="mt-5 rounded-2xl border border-warn/30 bg-warn-soft p-4">
              <div className="mb-1 text-[12px] font-semibold tracking-[0.08em] text-warn uppercase">Why it needs you</div>
              {why.length ? why.map((c, k) => <p key={k} className="text-[14px]">{c.message}</p>) : <p className="text-[14px]">{e.qualificationReason}</p>}
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[12px] text-muted">{k}</dt>
                  <dd className={cls("text-[15px]", !v && "text-muted")}>{v ?? "—"}</dd>
                </div>
              ))}
            </dl>

            {lastCaller.length > 0 && (
              <div className="mt-5 border-l-2 border-brand/50 pl-3 text-[13.5px] text-ink-2 italic">“{lastCaller.join(" … ")}”</div>
            )}

            <div className="mt-7 grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_auto]">
              <button className="btn btn-brand justify-center !py-3 text-[15px]" disabled={busy} onClick={() => decide("approved")}>
                Send to designer <kbd className="ml-1 rounded bg-white/20 px-1.5 text-[11px]">S</kbd>
              </button>
              <button className="btn justify-center !py-3 text-[15px]" disabled={busy} onClick={() => decide("closed")}>
                Not a fit <kbd className="ml-1 rounded bg-ink/10 px-1.5 text-[11px]">N</kbd>
              </button>
              <button className="btn justify-center !py-3" disabled={busy} onClick={skip} title="Skip for now">
                Skip →
              </button>
            </div>
            <button className="mt-4 text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => onOpenFull(e.id)}>
              Open the full enquiry and transcript
            </button>
          </>
        ) : (
          <div className="py-6 text-center">
            <div className="font-display text-[34px]">All checked.</div>
            <p className="mt-2 text-ink-2">
              {done.sent} sent to a designer · {done.closed} not a fit · {done.skipped} skipped
            </p>
            <button className="btn btn-primary mt-6" onClick={onDone}>
              Back to the dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
