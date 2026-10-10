import { NextResponse, type NextRequest } from "next/server";
import { demoMode } from "@/lib/notify";
import { simulateCompletedCall, type SimCallBody } from "@/lib/demo";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!demoMode()) return NextResponse.json({ error: "Demo mode is off" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as SimCallBody | null;
  if (!body?.transcript?.length || !body.facts) return NextResponse.json({ error: "Missing call data" }, { status: 400 });
  try {
    return NextResponse.json(await simulateCompletedCall(req.nextUrl.origin, body));
  } catch (e) {
    return NextResponse.json({ error: `Couldn't deliver the webhook: ${(e as Error).message}` }, { status: 502 });
  }
}
