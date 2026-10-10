import { NextResponse, type NextRequest } from "next/server";
import { icsInvite } from "@/lib/calendar";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** .ics invite for the consultation (opens in Apple Calendar, Outlook, Google Calendar…). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const e = await getStore().getEnquiry((await params).id);
  if (!e) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(icsInvite(e), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="aangan-consultation-${e.id}.ics"` } });
}
