import { NextResponse, type NextRequest } from "next/server";
import { demoMode } from "@/lib/notify";
import { seedReplays } from "@/lib/replay";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Reload the Sep 2026 phone transcripts as replay data. */
export async function POST() {
  if (!demoMode()) return NextResponse.json({ error: "Demo mode is off" }, { status: 403 });
  return NextResponse.json({ replayed: await seedReplays() });
}

/** Clear demo data: ?scope=simulated (calls made in the simulator) or ?scope=all (replays too). */
export async function DELETE(req: NextRequest) {
  if (!demoMode()) return NextResponse.json({ error: "Demo mode is off" }, { status: 403 });
  const scope = req.nextUrl.searchParams.get("scope") ?? "simulated";
  const removed = await getStore().deleteEnquiries((e) => e.source === "simulator" || (scope === "all" && e.source === "replay"));
  return NextResponse.json({ removed });
}
