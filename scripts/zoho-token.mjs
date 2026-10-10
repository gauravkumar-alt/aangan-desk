// Swap the one-time Zoho grant code in .env.local for a long-lived refresh token, and write it back.
// Usage: node scripts/zoho-token.mjs   (run within 10 minutes of generating the code)
import { readFileSync, writeFileSync } from "fs";

const file = new URL("../.env.local", import.meta.url);
let env = readFileSync(file, "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim();
const [id, secret, code, dc] = [get("ZOHO_CLIENT_ID"), get("ZOHO_CLIENT_SECRET"), get("ZOHO_GRANT_CODE"), get("ZOHO_DC") || "in"];
const missing = [!id && "ZOHO_CLIENT_ID", !secret && "ZOHO_CLIENT_SECRET", !code && "ZOHO_GRANT_CODE"].filter(Boolean);
if (missing.length) {
  console.error(`Missing in .env.local: ${missing.join(", ")}`);
  process.exit(1);
}
const p = new URLSearchParams({ grant_type: "authorization_code", client_id: id, client_secret: secret, code });
const res = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token?${p}`, { method: "POST" });
const j = await res.json();
if (!j.refresh_token) {
  console.error(`Zoho said: ${j.error ?? JSON.stringify(j)}`);
  if (j.error === "invalid_code") console.error("The code expired or was already used — generate a new one and run this again straight away.");
  process.exit(1);
}
env = env.replace(/^ZOHO_REFRESH_TOKEN=.*$/m, `ZOHO_REFRESH_TOKEN=${j.refresh_token}`).replace(/^ZOHO_GRANT_CODE=.*$/m, "ZOHO_GRANT_CODE=");
writeFileSync(file, env);
console.log("✓ Refresh token saved to .env.local (the one-time code has been cleared). Zoho is connected.");
