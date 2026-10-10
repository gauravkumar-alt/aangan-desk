import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { syncCrm } from "@/lib/crm";
import { derive, dispatchHandoff } from "@/lib/process";
import { loadRuleset } from "@/lib/rules/load";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const e = await getStore().getEnquiry((await params).id);
  return e ? NextResponse.json(e) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

const Patch = z.union([
  // Only a person records outcomes — the system never infers a won project.
  z.object({ outcome: z.object({ status: z.enum(["open", "won", "lost"]), valueInr: z.number().nonnegative().nullable().optional(), note: z.string().max(500).nullable().optional() }) }),
  z.object({ consultation: z.object({ status: z.enum(["not_booked", "booked"]), at: z.string().nullable().optional() }) }),
  z.object({ review: z.object({ decision: z.enum(["approved", "closed"]), note: z.string().max(500).nullable().optional() }).nullable() }),
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  const store = getStore();
  const e = await store.getEnquiry(id);
  if (!e) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const now = new Date().toISOString();
  if ("outcome" in parsed.data) {
    const o = parsed.data.outcome;
    const updated = { ...e, outcome: { status: o.status, valueInr: o.status === "won" ? o.valueInr ?? null : null, note: o.note ?? null, recordedAt: o.status === "open" ? null : now }, updatedAt: now };
    await store.saveEnquiry(updated);
    return NextResponse.json(updated);
  }
  if ("consultation" in parsed.data) {
    const c = parsed.data.consultation;
    const updated = { ...e, consultation: { status: c.status, at: c.at ?? null, bookedAt: c.status === "booked" ? now : null }, updatedAt: now };
    await store.saveEnquiry(updated);
    return NextResponse.json(updated);
  }
  const r = parsed.data.review;
  const [rules, settings] = await Promise.all([loadRuleset(), store.getSettings()]);
  const updated = derive({ ...e, review: r ? { decision: r.decision, note: r.note ?? null, at: now } : null }, rules, settings);
  await store.saveEnquiry(updated);
  if (updated.handoff.required && updated.handoff.status === "PENDING") await dispatchHandoff(id);
  return NextResponse.json((await syncCrm(id)) ?? updated);
}
