import { NextResponse, type NextRequest } from "next/server";
import { demoMode } from "@/lib/notify";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// Stand-in for VaaniVoice's GET /api/call_details/{call_id} (header X-API-Key), demo mode only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!demoMode()) return NextResponse.json({ detail: "Not found" }, { status: 404 });
  if (req.headers.get("x-api-key") !== "demo") return NextResponse.json({ detail: "Invalid API key" }, { status: 401 });
  if ((await getStore().getSettings()).simulateVaaniApiFailure) return NextResponse.json({ detail: "Service unavailable (simulated)" }, { status: 503 });
  const id = (await params).id;
  const ev = (await getStore().listEvents(2000)).find((e) => e.key === `sim-call:${id}`);
  return ev ? NextResponse.json(JSON.parse(ev.rawBody)) : NextResponse.json({ detail: "Call not found" }, { status: 404 });
}
