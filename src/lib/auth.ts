export const SESSION_COOKIE = "aangan_session";

export async function sessionToken(password: string) {
  const bytes = new TextEncoder().encode(`aangan-desk:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
