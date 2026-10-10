import { after, NextResponse, type NextRequest } from "next/server";
import { SIGNATURE_HEADER } from "@/lib/vaani/signature";
import { handleVaaniVoiceWebhook, vaaniProvider } from "@/lib/vaani/vaanivoice";
import { handleVaaniWebhook } from "@/lib/vaani/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// VaaniVoice (default): Settings → Webhooks → https://<host>/api/vaani/webhook?token=<VAANI_WEBHOOK_TOKEN>
// VaaniYantra (VAANI_PROVIDER=vaaniyantra): signed with X-VaaniYantra-Signature, no token.
export async function POST(req: NextRequest) {
  const raw = await req.text(); // raw bytes — never re-serialise before verifying
  const origin = req.nextUrl.origin;
  const out =
    vaaniProvider() === "vaaniyantra"
      ? await handleVaaniWebhook(raw, req.headers.get(SIGNATURE_HEADER), origin)
      : await handleVaaniVoiceWebhook(raw, req.nextUrl.searchParams.get("token"), origin);
  if (out.status === 200 && "followUp" in out && out.followUp) after(out.followUp); // respond first, then enrich + hand off
  return NextResponse.json(out.body, { status: out.status });
}
