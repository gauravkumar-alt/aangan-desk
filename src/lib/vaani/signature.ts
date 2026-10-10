import { createHmac, timingSafeEqual } from "crypto";

// VaaniYantra webhook signing (developer guide → Webhooks):
//   X-VaaniYantra-Signature: sha256=<hex HMAC-SHA256 of the raw request body, keyed with the whsec_ secret>
// Verify against the raw bytes, never re-serialised JSON.

export const SIGNATURE_HEADER = "x-vaaniyantra-signature";
export const EVENT_HEADER = "x-vaaniyantra-event";

export function sign(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(sign(rawBody, secret));
  const given = Buffer.from(header.trim());
  // timingSafeEqual throws on length mismatch — check first (the docs' example omits this).
  return expected.length === given.length && timingSafeEqual(expected, given);
}
