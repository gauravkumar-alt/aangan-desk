import { NextResponse, type NextRequest } from "next/server";
import { demoMode } from "@/lib/notify";
import { simulateMissedCall } from "@/lib/demo";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!demoMode()) return NextResponse.json({ error: "Demo mode is off" }, { status: 403 });
  const { phone } = (await req.json().catch(() => ({}))) as { phone?: string };
  try {
    return NextResponse.json(await simulateMissedCall(req.nextUrl.origin, phone || "+919800000000"));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
