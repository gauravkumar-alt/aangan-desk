// One-off: split the extracted Sep 2026 transcript text into one file per enquiry (T01…, W01…, F01…).
import { readFileSync, writeFileSync } from "fs";
const raw = readFileSync(process.argv[2], "utf8")
  .replace(/\n===== PAGE \d+ =====\n/g, "\n")
  .replace(/\r/g, "");
const re = /^([TWF]\d{2}) · (Phone|WhatsApp|Web Form) · /gm;
const starts = [...raw.matchAll(re)].map((m) => ({ id: m[1], channel: m[2], at: m.index }));
const sectionBreak = /^SECTION \d — .*$/m;
starts.forEach((s, i) => {
  let body = raw.slice(s.at, starts[i + 1]?.at ?? raw.length);
  const cut = body.search(sectionBreak);
  if (cut > 0) body = body.slice(0, cut);
  const dir = process.argv[3];
  writeFileSync(`${dir}/${s.id}.md`, `<!-- Source: Aangan_Sep 2026_Enquiries.pdf · channel: ${s.channel} -->\n` + body.trim() + "\n");
});
console.log(starts.length, "enquiries");
