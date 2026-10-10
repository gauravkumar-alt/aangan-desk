import { NextResponse, type NextRequest } from "next/server";
import { retryPendingCrm } from "@/lib/crm";
import { retryPendingHandoffs } from "@/lib/process";

const retryAll = async () => ({ handoffs: await retryPendingHandoffs(), crm: await retryPendingCrm() });

export const dynamic = "force-dynamic";

// POST from the dashboard; GET from Vercel Cron (vercel.json), which sends Authorization: Bearer $CRON_SECRET.
export async function POST() {
  return NextResponse.json(await retryAll());
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await retryAll());
}
