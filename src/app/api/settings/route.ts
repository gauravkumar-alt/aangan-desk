import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { rederiveAll } from "@/lib/process";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getStore().getSettings());
}

const Body = z.object({
  vaaniRatePerMinInr: z.number().min(0).max(1000).optional(),
  telephonyPerMinInr: z.number().min(0).max(1000).optional(),
  billingIncrementSec: z.number().int().min(1).max(600).optional(),
  simulateHandoffFailure: z.boolean().optional(),
  simulateVaaniApiFailure: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" }, { status: 400 });
  const store = getStore();
  const current = await store.getSettings();
  const next = { ...current, ...parsed.data, updatedAt: new Date().toISOString() };
  await store.saveSettings(next);
  const costChanged = ["vaaniRatePerMinInr", "telephonyPerMinInr", "billingIncrementSec"].some((k) => k in parsed.data);
  if (costChanged) await rederiveAll(); // every call's cost is recomputed at the new rate
  return NextResponse.json(next);
}
