import { NextResponse, type NextRequest } from "next/server";
import { dispatchHandoff } from "@/lib/process";

export const dynamic = "force-dynamic";

/** Send or retry this enquiry's handoff. Already-sent handoffs are not re-sent. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const e = await dispatchHandoff((await params).id);
  if (!e) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(e);
}
