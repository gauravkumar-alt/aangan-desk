import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";

// Optional shared password for the dashboard (APP_PASSWORD). Webhooks and the cron endpoint are
// authenticated by their own signatures/secrets, so they bypass the session gate.
export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token && token === (await sessionToken(password))) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Signed out" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/login|api/vaani/webhook|api/demo/vaani-mock|api/handoffs/retry|_next/|favicon).*)"],
};
