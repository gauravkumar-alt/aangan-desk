"use client";
import { useEffect, useMemo, useState } from "react";
import { calendlyLink, googleCalendarLink } from "@/lib/calendar";
import type { Enquiry, RuleCheck } from "@/lib/types";
import { Badge, channelName, cls, fmtDur, fmtInr, fmtLakh, fmtTime, HandoffBadge, QualBadge, sourceLabel } from "./ui";

const OUTCOME_TONE: Record<RuleCheck["outcome"], string> = {
  PASS: "bg-ok-soft text-ok",
  NOT_QUALIFIED: "bg-bad-soft text-bad",
  NEEDS_REVIEW: "bg-warn-soft text-warn",
  ESCALATE: "bg-info-soft text-info",
  INFO: "bg-line-2 text-ink-2",
};

export function EnquiryDrawer({ e, all, onClose, onChanged, onOpen, calendlyUrl }: { e: Enquiry; all: Enquiry[]; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void; calendlyUrl?: string | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"handoff" | "transcript" | "checks">("handoff");
  const [wonValue, setWonValue] = useState("");
  const calLink = useMemo(() => (e.handoff.kind === "designer" ? googleCalendarLink(e) : null), [e]);
  const bookLink = useMemo(() => (e.handoff.kind === "designer" && calendlyUrl ? calendlyLink(e, calendlyUrl) : null), [e, calendlyUrl]);

  useEffect(() => {
    const k = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  async function call(label: string, url: string, init: RequestInit = { method: "POST" }) {
    setBusy(label);
    try {
      await fetch(url, init);
      onChanged();
    } finally {
      setBusy(null);
    }
  }
  const patch = (label: string, body: unknown) => call(label, `/api/enquiries/${e.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const prev = e.previousEnquiryId ? all.find((x) => x.id === e.previousEnquiryId) : null;
  const next = e.supersededBy ? all.find((x) => x.id === e.supersededBy) : null;
  const facts: [string, React.ReactNode][] = [
    ["Phone", e.phone ?? (e.source === "replay" ? "Anonymised in the source" : "—")],
    ["Project", [e.projectType?.replace("_", " "), e.scope === "full" ? "full scope" : e.scope === "partial" ? "selected rooms" : e.scope === "advisory" ? "advice only" : null].filter(Boolean).join(" · ") || "—"],
    ["Property", [e.propertyType, e.projectStage].filter(Boolean).join(" · ") || "—"],
    ["Location", e.location ?? "—"],
    ["Area", e.areaSqFt ? `${e.areaSqFt.toLocaleString("en-IN")} sq ft` : e.unknownFields.includes("areaSqFt") ? "Caller didn't know" : e.declinedFields.includes("areaSqFt") ? "Preferred not to say" : "—"],
    ["Spaces", e.spaces.join(", ") || "—"],
    ["Timeline", e.timeline ?? "—"],
    ["Budget", e.budget ?? (e.declinedFields.includes("budget") ? "Preferred not to say" : "Not mentioned (never asked)")],
    ["Ownership", e.ownership ?? "—"],
    ["Decision-maker", e.decisionMaker?.replace("_", " ") ?? "Not confirmed"],
    ["Source", e.referral ?? "—"],
  ];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <aside className="fade-in flex h-full w-full max-w-[720px] flex-col overflow-hidden bg-paper shadow-2xl" onClick={(ev) => ev.stopPropagation()}>
        <div className="border-b border-line bg-surface px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[18px] font-bold">{e.callerName ?? "Unknown caller"}</h2>
                <QualBadge e={e} />
                <HandoffBadge e={e} />
              </div>
              <div className="mt-1 text-[12px] text-muted">
                {fmtTime(e.createdAt)} · {sourceLabel(e.source)} · {e.callStatus.replace(/_/g, " ")}
                {e.callDurationSeconds ? ` · ${fmtDur(e.callDurationSeconds)}` : ""}
                {e.answerDelaySec != null ? ` · picked up in ${e.answerDelaySec}s` : ""}
                {e.afterHours ? " · after hours" : ""}
              </div>
            </div>
            <button className="btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          <p className="mt-3 text-[13px] text-ink-2">{e.qualificationReason}</p>
          <div className="mt-2 rounded-lg bg-brand-soft px-3 py-2 text-[13px]">
            <b>Next step:</b> {e.recommendedNextAction}
          </div>
          {(prev || next) && (
            <div className="mt-2 text-[12px] text-muted">
              {prev && (
                <button className="underline" onClick={() => onOpen(prev.id)}>
                  Continues an earlier call ({fmtTime(prev.createdAt)})
                </button>
              )}
              {next && (
                <button className="underline" onClick={() => onOpen(next.id)}>
                  Continued in a later call ({fmtTime(next.createdAt)})
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {e.handoff.required && e.handoff.status !== "SENT" && (
              <button className="btn btn-brand" disabled={!!busy} onClick={() => call("send", `/api/enquiries/${e.id}/handoff`)}>
                {busy === "send" ? "Sending…" : "Retry handoff"}
              </button>
            )}
            {e.qualificationStatus === "NEEDS_REVIEW" && e.intent !== "existing_client" && !e.review && (
              <>
                <button className="btn btn-primary" disabled={!!busy} onClick={() => patch("approve", { review: { decision: "approved" } })}>
                  Approve & send to designer
                </button>
                <button className="btn" disabled={!!busy} onClick={() => patch("close", { review: { decision: "closed" } })}>
                  Close
                </button>
              </>
            )}
            {e.review && (
              <button className="btn" disabled={!!busy} onClick={() => patch("undo", { review: null })}>
                Undo review ({e.review.decision})
              </button>
            )}
            {e.transcriptStatus === "fetch_failed" && (
              <button className="btn" disabled={!!busy} onClick={() => call("refetch", `/api/enquiries/${e.id}/refetch`)}>
                {busy === "refetch" ? "Fetching…" : "Retry transcript fetch from Vaani"}
              </button>
            )}
          </div>

          {e.processingErrors.length > 0 && (
            <div className="rounded-lg border border-bad/20 bg-bad-soft p-3 text-[12px] text-bad">
              <div className="mb-1 font-semibold">Integration errors (the enquiry is safe)</div>
              {e.processingErrors.map((x) => (
                <div key={x}>{x}</div>
              ))}
            </div>
          )}

          {/* Facts */}
          <div className="card grid grid-cols-1 gap-x-6 gap-y-2 p-4 sm:grid-cols-2">
            {facts.map(([k, v]) => (
              <div key={k} className="flex gap-2 text-[13px]">
                <span className="w-28 shrink-0 text-muted">{k}</span>
                <span className="min-w-0">{v}</span>
              </div>
            ))}
            {e.flags.length > 0 && (
              <div className="col-span-full flex flex-wrap gap-1.5 pt-1">
                {e.flags.map((f) => (
                  <Badge key={f} tone="bg-brand-soft text-brand">
                    {f}
                  </Badge>
                ))}
              </div>
            )}
            {e.corrections.length > 0 && (
              <div className="col-span-full text-[12px] text-ink-2">
                Caller corrected: {e.corrections.map((c) => `${String(c.field)} “${c.from}” → “${c.to}”`).join("; ")}
              </div>
            )}
          </div>

          {/* Pricing (internal) */}
          <div className="card p-4">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-semibold">Indicative pricing</span>
              <Badge tone="bg-info-soft text-info">INTERNAL — NEVER QUOTED TO CALLER</Badge>
            </div>
            {e.pricing.status === "estimated" && e.indicativePriceMin != null ? (
              <>
                <div className="num text-[22px] font-bold">
                  {fmtLakh(e.indicativePriceMin)}–{e.indicativePriceMax ? fmtLakh(e.indicativePriceMax).replace("₹", "") : "+"}
                </div>
                <div className="text-[12px] text-ink-2">{e.pricing.basis}</div>
                {e.pricing.alternatives.length > 0 && (
                  <div className="mt-1 text-[12px] text-muted">
                    Other tiers: {e.pricing.alternatives.map((a) => `${a.label} ${fmtLakh(a.minInr)}–${a.maxInr ? fmtLakh(a.maxInr).replace("₹", "") : "+"}`).join(" · ")}
                  </div>
                )}
              </>
            ) : (
              <div className="text-[13px] text-ink-2">{e.pricing.status === "designer_quote" ? "Designer to quote. " : "Not estimated. "}{e.pricing.basis}</div>
            )}
            <div className="mt-2 text-[11px] text-muted">{e.pricing.disclaimer}</div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-line">
            {(
              [
                ["handoff", e.handoff.kind === "escalation" ? "Escalation note" : "Designer handoff"],
                ["checks", "Qualification checks"],
                ["transcript", `Transcript${e.transcriptStatus !== "complete" ? ` (${e.transcriptStatus.replace("_", " ")})` : ""}`],
              ] as const
            ).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={cls("-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold", tab === k ? "border-brand text-ink" : "border-transparent text-muted")}>
                {l}
              </button>
            ))}
          </div>

          {tab === "handoff" &&
            (e.handoff.note ? (
              <div className="space-y-3">
                <div className="rounded-xl bg-[#1d2430] p-3">
                  <div className="mb-1 text-[11px] font-semibold text-info">
                    {e.handoff.status === "SENT" ? `Delivered via ${channelName(e.handoff.channel)} · ${e.handoff.sentAt ? fmtTime(e.handoff.sentAt) : ""}` : "Not delivered yet — shown as it will be sent"}
                  </div>
                  <div className="rounded-lg bg-surface p-3 text-[13px] leading-relaxed ring-1 ring-line">
                    <div className="mb-2 font-bold">{e.handoff.note.title}</div>
                    {e.handoff.note.lines.map((l) => (
                      <div key={l.label}>
                        <b>{l.label}:</b> {l.value}
                      </div>
                    ))}
                    <div className="mt-2 font-bold">Important notes:</div>
                    {(e.handoff.note.importantNotes.length ? e.handoff.note.importantNotes : ["—"]).map((n) => (
                      <div key={n}>• {n}</div>
                    ))}
                    <div className="mt-2">
                      <b>Recommended next step:</b> {e.handoff.note.nextStep}
                    </div>
                    {calLink && <div className="mt-2 text-info">📅 Book the consultation</div>}
                  </div>
                </div>
                {e.handoff.attempts.length > 0 && (
                  <div className="text-[12px]">
                    <div className="label mb-1">Delivery attempts</div>
                    {e.handoff.attempts.map((a, i) => (
                      <div key={i} className={a.ok ? "text-ok" : "text-bad"}>
                        {fmtTime(a.at)} · {channelName(a.channel)} · {a.ok ? "delivered" : a.error}
                      </div>
                    ))}
                  </div>
                )}
                {calLink && (
                  <div className="card p-4">
                    <div className="mb-2 font-semibold">Consultation</div>
                    {e.consultation?.status === "booked" ? (
                      <div className="flex items-center gap-2 text-[13px]">
                        <Badge tone="bg-ok-soft text-ok">BOOKED</Badge>
                        {e.consultation.at ? fmtTime(e.consultation.at) : ""}
                        <button className="btn ml-auto" onClick={() => patch("unbook", { consultation: { status: "not_booked" } })}>
                          Undo
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {bookLink && (
                          <a className="btn btn-brand" href={bookLink} target="_blank" rel="noreferrer">
                            Book on Calendly
                          </a>
                        )}
                        <a className={bookLink ? "btn" : "btn btn-primary"} href={calLink} target="_blank" rel="noreferrer">
                          Google Calendar
                        </a>
                        <a className="btn" href={`/api/enquiries/${e.id}/invite`}>
                          Download .ics invite
                        </a>
                        <ConsultationForm onSave={(at) => patch("book", { consultation: { status: "booked", at } })} />
                      </div>
                    )}
                    <div className="mt-2 text-[11px] text-muted">{bookLink ? "Calendly opens pre-filled with the caller's name and brief — book a slot with the caller on the call-back (or send them the link), then mark it booked." : "The calendar event is pre-filled with this brief at a suggested next-working-day 11am slot. Confirm the time with the caller, then mark it booked."}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[13px] text-muted">No handoff: {e.qualificationStatus === "NOT_QUALIFIED" ? "not qualified, so not forwarded (qualified.md)." : e.qualificationStatus === "NEEDS_REVIEW" ? "waiting for a person to review." : "nothing to forward."}</div>
            ))}

          {tab === "checks" && (
            <div className="space-y-2">
              {e.checks.map((c, i) => (
                <div key={i} className="card p-3 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={OUTCOME_TONE[c.outcome]}>{c.outcome.replace("_", " ")}</Badge>
                    <span className="font-semibold">{c.criterion ?? c.ruleId}</span>
                  </div>
                  <div className="mt-1 text-ink-2">{c.message}</div>
                  {c.ambiguity && <div className="mt-1 rounded-md bg-warn-soft px-2 py-1 text-[12px] text-warn">Ambiguity: {c.ambiguity}</div>}
                  {c.evidence.length > 0 && <div className="mt-1 text-[11px] text-muted">Source: {c.evidence.join(" · ")}</div>}
                </div>
              ))}
              {!e.checks.length && <div className="text-muted">No checks ran ({e.qualificationReason}).</div>}
            </div>
          )}

          {tab === "transcript" && (
            <div className="space-y-2">
              {e.transcript.map((t, i) => (
                <div key={i} className={cls("flex", t.role === "AGENT" ? "justify-start" : "justify-end")}>
                  <div className={cls("max-w-[85%] rounded-2xl px-3 py-2 text-[13px]", t.role === "AGENT" ? "bg-surface border border-line" : "bg-ink text-paper")}>
                    <div className="mb-0.5 text-[10px] font-bold uppercase opacity-60">{t.role === "AGENT" ? (e.source === "replay" ? "Front desk (Sep 2026)" : "AI front desk") : "Caller"}</div>
                    {t.text}
                  </div>
                </div>
              ))}
              {!e.transcript.length && <div className="text-[13px] text-muted">{e.transcriptStatus === "fetch_failed" ? "Couldn't fetch the transcript from Vaani. Qualification used the call's collected data." : "No transcript."}</div>}
              {e.notes && <div className="text-[12px] text-muted">Notes: {e.notes}</div>}
            </div>
          )}

          {/* CRM */}
          {e.crm && (
            <div className="card p-4 text-[13px]">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                {e.crm.provider === "zoho" ? "Zoho CRM" : "HubSpot"}{" "}
                <Badge tone={e.crm.status === "SYNCED" ? "bg-ok-soft text-ok" : e.crm.status === "PENDING" ? "bg-warn-soft text-warn" : "bg-line-2 text-ink-2"}>{e.crm.status === "PENDING" ? "SYNC PENDING" : e.crm.status}</Badge>
              </div>
              {e.crm.status === "SKIPPED" && <div className="text-muted">{e.crm.skippedReason}</div>}
              {e.crm.contactId && <div>{e.crm.recordType === "Lead" ? "Lead" : "Contact"} #{e.crm.contactId}{e.crm.dealId && <> · Deal #{e.crm.dealId}</>}</div>}
              {e.crm.lastError && <div className="text-bad">{e.crm.lastError}</div>}
              {e.crm.status === "PENDING" && (
                <button className="btn mt-2" disabled={!!busy} onClick={() => call("crm", "/api/handoffs/retry")}>
                  Retry sync
                </button>
              )}
            </div>
          )}

          {/* Cost */}
          <div className="card p-4 text-[13px]">
            <div className="mb-1 font-semibold">AI cost for this call</div>
            <div className="num text-[18px] font-bold">{fmtInr(e.cost.estimatedInr)}</div>
            <div className="text-[12px] text-ink-2">{e.cost.note}</div>
          </div>

          {/* Outcome — only a person records this */}
          {e.handoff.kind === "designer" && (
            <div className="card p-4 text-[13px]">
              <div className="mb-1 font-semibold">Project outcome</div>
              <div className="mb-2 text-[12px] text-muted">Recorded by the studio. The system never assumes a project was won.</div>
              {e.outcome.status === "open" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input className="input max-w-[200px]" placeholder="Signed value (₹)" inputMode="numeric" value={wonValue} onChange={(ev) => setWonValue(ev.target.value.replace(/[^\d]/g, ""))} />
                  <button className="btn btn-primary" disabled={!wonValue || !!busy} onClick={() => patch("won", { outcome: { status: "won", valueInr: Number(wonValue) } })}>
                    Mark won
                  </button>
                  <button className="btn" disabled={!!busy} onClick={() => patch("lost", { outcome: { status: "lost" } })}>
                    Mark lost
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Badge tone={e.outcome.status === "won" ? "bg-ok-soft text-ok" : "bg-line-2 text-ink-2"}>{e.outcome.status.toUpperCase()}</Badge>
                  {e.outcome.valueInr ? fmtInr(e.outcome.valueInr) : ""}
                  <button className="btn ml-auto" onClick={() => patch("reopen", { outcome: { status: "open" } })}>
                    Undo
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function ConsultationForm({ onSave }: { onSave: (iso: string | null) => void }) {
  const [v, setV] = useState("");
  return (
    <span className="inline-flex gap-2">
      <input type="datetime-local" className="input w-auto" value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn" onClick={() => onSave(v ? new Date(`${v}:00+05:30`).toISOString() : null)}>
        Mark booked
      </button>
    </span>
  );
}
