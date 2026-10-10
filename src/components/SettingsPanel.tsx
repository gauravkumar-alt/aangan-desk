"use client";
import { useState } from "react";
import type { DashboardData } from "@/lib/dashboard";
import { cls } from "./ui";

export function SettingsPanel({ data, onClose, onChanged }: { data: DashboardData; onClose: () => void; onChanged: () => void }) {
  const s = data.settings;
  const [rate, setRate] = useState(String(s.vaaniRatePerMinInr));
  const [tel, setTel] = useState(String(s.telephonyPerMinInr));
  const [inc, setInc] = useState(String(s.billingIncrementSec));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function put(body: object, note: string) {
    setBusy(true);
    const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    setMsg(r.ok ? note : `Error: ${(await r.json()).error}`);
    onChanged();
  }
  async function demo(url: string, init: RequestInit, note: (j: Record<string, unknown>) => string) {
    setBusy(true);
    const r = await fetch(url, init);
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? note(j) : `Error: ${j.error}`);
    onChanged();
  }
  const it = data.integrations;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/25" onClick={onClose}>
      <aside className="fade-in h-full w-full max-w-[460px] space-y-5 overflow-y-auto bg-paper p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-bold">Settings</h2>
          <button className="btn" onClick={onClose}>
            ✕
          </button>
        </div>
        {msg && <div className="rounded-lg bg-ok-soft px-3 py-2 text-[13px] text-ok">{msg}</div>}

        <section className="card space-y-3 p-4">
          <div className="font-semibold">AI cost model</div>
          <p className="text-[12px] text-muted">{s.rateLabel}</p>
          <Field label="Vaani rate (₹ per minute)" value={rate} onChange={setRate} />
          <Field label="Telephony (₹ per minute, if billed separately)" value={tel} onChange={setTel} />
          <Field label="Billing increment (seconds)" value={inc} onChange={setInc} />
          <button className="btn btn-primary" disabled={busy} onClick={() => put({ vaaniRatePerMinInr: Number(rate), telephonyPerMinInr: Number(tel), billingIncrementSec: Number(inc) }, "Saved. Every call's cost was recalculated.")}>
            Save & recalculate
          </button>
        </section>

        <section className="card space-y-2 p-4 text-[13px]">
          <div className="font-semibold">Integrations</div>
          <Row k="Voice platform" v={it.vaani.provider} ok />
          <Row k="Vaani webhook" v={it.vaani.webhookSecret ? "Protected (secret set)" : it.vaani.demoSecret ? "Demo secret — set VAANI_WEBHOOK_TOKEN for live calls" : "Not configured — webhooks rejected"} ok={it.vaani.webhookSecret} />
          <Row k="Vaani API (transcripts)" v={it.vaani.apiKey ? "VAANI_API_KEY set" : "Demo mock of the call-details API"} ok={it.vaani.apiKey} />
          <Row k="Handoff channel" v={it.handoff.label} ok={it.handoff.active === "telegram" || it.handoff.active === "email"} />
          <Row k="CRM" v={it.crm.active ? `${it.crm.label} — every caller synced, qualified → deal` : "Not connected (ZOHO_* in .env.local)"} ok={Boolean(it.crm.active)} />
          <Row k="Storage" v={it.store === "supabase" ? "Supabase" : "Local JSON file (demo)"} ok={it.store === "supabase"} />
          <div className="text-[12px] text-muted">Webhook URL for Vaani → Settings → Webhooks (must be a public https address): <code className="break-all rounded bg-line-2 px-1">{typeof window !== "undefined" ? window.location.origin : ""}/api/vaani/webhook{it.vaani.provider === "VaaniVoice" ? "?token=<VAANI_WEBHOOK_TOKEN>" : ""}</code></div>
        </section>

        {it.demo && (
          <section className="card space-y-3 p-4">
            <div className="font-semibold">Demo controls</div>
            <Toggle label="Simulate Telegram / handoff failure" on={s.simulateHandoffFailure} onChange={(v) => put({ simulateHandoffFailure: v }, v ? "Handoffs will now fail and stay PENDING." : "Handoffs back to normal. Use Retry to send pending ones.")} />
            <Toggle label="Simulate Vaani API failure (transcript fetch)" on={s.simulateVaaniApiFailure} onChange={(v) => put({ simulateVaaniApiFailure: v }, v ? "Transcript fetches will now fail." : "Vaani API back to normal.")} />
            <div className="flex flex-wrap gap-2 pt-1">
              <button className="btn" disabled={busy} onClick={() => demo("/api/demo/missed", { method: "POST", body: JSON.stringify({ phone: "+919822000111" }) }, () => "Missed call (call.failed) delivered — see Call back.")}>
                Simulate a missed call
              </button>
              <button className="btn" disabled={busy} onClick={() => demo("/api/demo/seed", { method: "POST" }, (j) => `Replayed ${j.replayed} September calls.`)}>
                Reload Sep 2026 replay
              </button>
              <button className="btn" disabled={busy} onClick={() => demo("/api/demo/seed?scope=simulated", { method: "DELETE" }, (j) => `Removed ${j.removed} simulated calls.`)}>
                Clear test calls
              </button>
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-[13px]">
      <span className="mb-1 block text-ink-2">{label}</span>
      <input className="input" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))} />
    </label>
  );
}
function Row({ k, v, ok }: { k: string; v: string; ok: boolean }) {
  return (
    <div className="flex gap-2">
      <span className={cls("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", ok ? "bg-ok" : "bg-warn")} />
      <span className="w-40 shrink-0 text-muted">{k}</span>
      <span>{v}</span>
    </div>
  );
}
function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className="flex w-full items-center justify-between gap-3 text-left text-[13px]">
      <span>{label}</span>
      <span className={cls("relative h-5 w-9 rounded-full transition", on ? "bg-bad" : "bg-line")}>
        <span className={cls("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition", on ? "left-[18px]" : "left-0.5")} />
      </span>
    </button>
  );
}
