import { NextResponse, type NextRequest } from "next/server";
import { dispatchHandoff, enrichFromVaani } from "@/lib/process";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Retry fetching the transcript from Vaani after a failure, then re-qualify and hand off if needed. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const e = await store.getEnquiry(id);
  if (!e) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (e.transcriptStatus === "fetch_failed") await store.saveEnquiry({ ...e, transcriptStatus: "pending_fetch" });
  await enrichFromVaani(id, req.nextUrl.origin);
  const after = await dispatchHandoff(id);
  return NextResponse.json(after);
}
