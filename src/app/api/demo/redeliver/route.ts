import { NextResponse, type NextRequest } from "next/server";
import { demoMode } from "@/lib/notify";
import { redeliver } from "@/lib/demo";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!demoMode()) return NextResponse.json({ error: "Demo mode is off" }, { status: 403 });
  const { callId } = (await req.json().catch(() => ({}))) as { callId?: string };
  if (!callId) return NextResponse.json({ error: "callId required" }, { status: 400 });
  try {
    return NextResponse.json(await redeliver(req.nextUrl.origin, callId));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
