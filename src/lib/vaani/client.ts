import "server-only";
import { VaaniCall } from "./payload";

// VaaniYantra REST API (developer guide → Calls): GET /api/v1/calls/:id returns { call } with the full
// transcript and startedAt, which the webhook omits. Auth: Authorization: Bearer ck_live_…  (scope calls:read)
// Env: VAANI_API_KEY, VAANI_API_BASE (default https://vaaniyantra.com).
// Demo mode without a key: points at the app's own mock of this endpoint (/api/demo/vaani-mock), so the
// exact same client code runs.

export class VaaniApiError extends Error {
  constructor(
    message: string,
    public status: number | null,
    public retryable: boolean,
  ) {
    super(message);
  }
}

export function vaaniApiConfig(origin?: string) {
  const key = process.env.VAANI_API_KEY;
  if (key) return { base: (process.env.VAANI_API_BASE || "https://vaaniyantra.com").replace(/\/$/, ""), key, mock: false };
  if (origin && (process.env.DEMO_MODE ?? "true") !== "false") return { base: `${origin}/api/demo/vaani-mock`, key: "demo", mock: true };
  return null;
}

export async function getCall(callId: string, origin?: string): Promise<VaaniCall> {
  const cfg = vaaniApiConfig(origin);
  if (!cfg) throw new VaaniApiError("VAANI_API_KEY not configured — transcript can't be fetched.", null, false);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${cfg.base}/api/v1/calls/${encodeURIComponent(callId)}`, {
      headers: { Authorization: `Bearer ${cfg.key}`, Accept: "application/json" },
      signal: ctl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status >= 500;
      throw new VaaniApiError(`Vaani API ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`, res.status, retryable);
    }
    const json = (await res.json()) as { call?: unknown };
    const parsed = VaaniCall.safeParse(json.call);
    if (!parsed.success) throw new VaaniApiError("Vaani API returned an unexpected call shape.", res.status, false);
    return parsed.data;
  } catch (e) {
    if (e instanceof VaaniApiError) throw e;
    const msg = (e as Error).name === "AbortError" ? "Vaani API timed out after 8s" : `Network error reaching Vaani: ${(e as Error).message}`;
    throw new VaaniApiError(msg, null, true);
  } finally {
    clearTimeout(timer);
  }
}
