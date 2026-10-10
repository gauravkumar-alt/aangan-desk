import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/store";
import { reprocessEvent } from "@/lib/vaani/webhook";

export const dynamic = "force-dynamic";

/** Webhook inbox (for the integration panel). Raw bodies are left out of the listing. */
export async function GET() {
  const events = (await getStore().listEvents(100)).filter((e) => e.event !== "sim.call").map(({ rawBody: _r, ...rest }) => rest);
  return NextResponse.json({ events });
}

export async function POST(req: NextRequest) {
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  try {
    return NextResponse.json(await reprocessEvent(key, req.nextUrl.origin));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
