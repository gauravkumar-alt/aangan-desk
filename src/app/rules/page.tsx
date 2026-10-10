import { Header } from "@/components/ui";
import { loadRuleset } from "@/lib/rules/load";
import { ruleAmbiguities, ruleWarnings } from "@/lib/rules/schema";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const rules = await loadRuleset();
  const warnings = ruleWarnings(rules);
  const amb = ruleAmbiguities(rules);
  return (
    <>
      <Header active="rules" />
      <main className="mx-auto max-w-[1100px] space-y-5 px-4 py-5">
        <div>
          <h1 className="text-[22px] font-bold">Rules the front desk runs on</h1>
          <p className="mt-1 text-[13px] text-ink-2">
            Loaded at runtime from <code>case/services.md</code>, <code>case/qualified.md</code> and <code>case/pricing.md</code>. The studio&apos;s text is kept verbatim. Each file ends with a machine-readable block that cites it. Edit a file and the next call uses it.
          </p>
        </div>
        {warnings.length > 0 && <div className="card bg-bad-soft p-3 text-[13px] text-bad">{warnings.map((w) => <div key={w}>{w}</div>)}</div>}

        <section className="card p-5">
          <div className="mb-1 font-semibold">Open questions for Nikhil</div>
          <p className="mb-3 text-[12px] text-muted">Places where the files don&apos;t settle a question. The system doesn&apos;t guess: it sends these enquiries to NEEDS REVIEW or notes them in the handoff.</p>
          <div className="space-y-2">
            {amb.map((a, i) => (
              <div key={i} className={`rounded-lg border p-3 text-[13px] ${i === 0 ? "border-brand/40 bg-brand-soft" : "border-line-2 bg-paper"}`}>
                <div className="font-semibold">
                  {a.topic} <span className="font-normal text-muted">· {a.file}</span>
                </div>
                <div className="mt-0.5 text-ink-2">{a.text}</div>
              </div>
            ))}
          </div>
        </section>

        {[rules.qualified, rules.services, rules.pricing].map((f) => (
          <section key={f.name} className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="font-semibold">{f.name}</span>
              <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${f.state === "loaded" ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{f.state === "loaded" ? (f.status ?? "loaded").toUpperCase() : f.state.toUpperCase()}</span>
            </div>
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg bg-paper p-4 font-sans text-[13px] leading-relaxed text-ink-2">{f.prose.split("\n---\n\n## Machine-readable")[0]}</pre>
          </section>
        ))}
      </main>
    </>
  );
}
