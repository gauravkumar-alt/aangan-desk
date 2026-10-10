import { NextResponse, type NextRequest } from "next/server";
import { getSimCall } from "@/lib/demo";
import { demoMode } from "@/lib/notify";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// Stand-in for VaaniYantra's GET /api/v1/calls/:id, used only in demo mode when no VAANI_API_KEY is set,
// so the real API client (src/lib/vaani/client.ts) runs unchanged. Same auth header, same { call } shape.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!demoMode()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.headers.get("authorization") !== "Bearer demo") return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  if ((await getStore().getSettings()).simulateVaaniApiFailure) return NextResponse.json({ error: "Service unavailable (simulated)" }, { status: 503 });
  const call = await getSimCall((await params).id);
  return call ? NextResponse.json({ call }) : NextResponse.json({ error: "Call not found" }, { status: 404 });
}
