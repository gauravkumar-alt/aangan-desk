// Geography, not business rules: which named places are inside Pune city / PCMC. Whether those regions
// are served comes from case/services.md. Anything not listed is "unrecognised" → a person checks it.

const PUNE = [
  "aundh", "baner", "balewadi", "pashan", "sus", "bavdhan", "kothrud", "dahanukar colony", "karve nagar", "karvenagar",
  "warje", "shivane", "erandwane", "deccan", "shivajinagar", "shivaji nagar", "model colony", "prabhat road", "law college road",
  "fc road", "camp", "pune camp", "koregaon park", "kalyani nagar", "kalyaninagar", "viman nagar", "vimannagar", "yerawada",
  "yerwada", "kharadi", "wadgaon sheri", "vadgaon sheri", "magarpatta", "cybercity", "hadapsar", "amanora", "mundhwa",
  "keshav nagar", "wagholi", "undri", "nibm", "nibm road", "kondhwa", "wanowrie", "salunkhe vihar", "fatima nagar", "katraj",
  "dhankawadi", "bibwewadi", "sinhagad road", "dhayari", "nanded city", "narhe", "ambegaon", "sahakar nagar", "parvati",
  "swargate", "sadashiv peth", "narayan peth", "kasba peth", "shukrawar peth", "bopodi", "khadki", "dhanori", "lohegaon",
  "vishrantwadi", "tingre nagar", "boat club road", "lullanagar", "mohammed wadi", "handewadi", "sunderban", "sopan baug",
  "bund garden", "east street", "sb road", "senapati bapat road", "gokhale nagar", "range hills", "pune",
];

const PCMC = [
  "pimple saudagar", "pimple nilakh", "pimple gurav", "wakad", "hinjewadi", "hinjawadi", "tathawade", "punawale", "ravet",
  "akurdi", "nigdi", "pradhikaran", "chinchwad", "pimpri", "bhosari", "moshi", "chikhli", "dighi", "sangvi", "new sangvi",
  "kasarwadi", "thergaon", "rahatani", "kalewadi", "maan", "marunji", "mahalunge", "pcmc", "pimpri chinchwad", "pimpri-chinchwad",
];

// Well-known cities that are clearly not Pune/PCMC.
const OUTSIDE = [
  "mumbai", "bombay", "thane", "navi mumbai", "nashik", "nasik", "nagpur", "aurangabad", "sambhajinagar", "kolhapur", "satara",
  "sangli", "solapur", "ahmednagar", "goa", "bangalore", "bengaluru", "hyderabad", "chennai", "delhi", "gurgaon", "gurugram",
  "noida", "kolkata", "ahmedabad", "surat", "indore", "jaipur", "panvel", "kalyan", "dombivli",
];

// Places that sit at the edge and aren't on either list — kept here only so they're recognised as
// places. Whether they're served is decided by services.md edgeAreas or by a person.
const NEARBY_UNLISTED = ["talegaon", "talegaon dabhade", "chakan", "lonavala", "khandala", "saswad", "shirur", "uruli", "manjri", "bhugaon", "pirangut", "kamshet", "alandi", "dehu", "ranjangaon"];

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bNibm\b/, "NIBM").replace(/\bPcmc\b/, "PCMC").replace(/\bFc\b/, "FC").replace(/\bSb\b/, "SB");

export interface LocalityMatch {
  name: string;
  region: "Pune" | "PCMC" | "outside" | "nearby";
}

const ALL: LocalityMatch[] = [
  ...PUNE.map((n) => ({ name: n, region: "Pune" as const })),
  ...PCMC.map((n) => ({ name: n, region: "PCMC" as const })),
  ...OUTSIDE.map((n) => ({ name: n, region: "outside" as const })),
  ...NEARBY_UNLISTED.map((n) => ({ name: n, region: "nearby" as const })),
].sort((a, b) => b.name.length - a.name.length); // longest first: "pimple saudagar" before "pune"

/** Find every place named in the text, most specific first. "Pune" alone only wins if nothing else matches. */
export function findLocalities(text: string): LocalityMatch[] {
  const t = ` ${text.toLowerCase().replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ")} `;
  const found: (LocalityMatch & { at: number })[] = [];
  let rest = t;
  for (const l of ALL) {
    const needle = ` ${l.name} `;
    const at = rest.indexOf(needle);
    if (at >= 0) {
      found.push({ ...l, name: titleCase(l.name), at });
      rest = rest.split(needle).join(" ".repeat(needle.length)); // keep positions stable
    }
  }
  // First place mentioned wins: "3BHK in Kothrud — Dahanukar Colony" → Kothrud
  const hits: LocalityMatch[] = found.sort((a, b) => a.at - b.at).map(({ name, region }) => ({ name, region }));
  const specific = hits.filter((h) => h.name.toLowerCase() !== "pune");
  if (specific.length) return specific;
  const fuzzy = fuzzyLocality(t);
  return fuzzy ? [fuzzy] : hits;
}

// Speech-to-text garbles: "Hinduwari", "Sanhinjawari" → Hinjewadi. Known garbles first, then edit distance.
const ALIASES: Record<string, string> = { hinduwari: "hinjewadi", hinjawari: "hinjewadi", hinjewari: "hinjewadi", hinjvadi: "hinjewadi", kotrud: "kothrud", vimannagar: "viman nagar", kalyaninagar: "kalyani nagar", koregaon: "koregaon park", magarpatta: "magarpatta", pimplesaudagar: "pimple saudagar", wakkad: "wakad", baaner: "baner", undhri: "undri", kharadhi: "kharadi" };

function lev(a: string, b: string) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

function fuzzyLocality(t: string): LocalityMatch | null {
  const raw = t.trim().split(" ");
  // single words, plus adjacent pairs joined ("pimple saudagr" → "pimplesaudagr") for two-word places
  const words = [...raw, ...raw.slice(1).map((w, i) => raw[i] + w)].filter((w) => w.length >= 5);
  const byName = new Map(ALL.map((l) => [l.name, l]));
  for (const w of words) {
    const alias = ALIASES[w] ?? Object.entries(ALIASES).find(([k]) => w.endsWith(k) && w.length - k.length <= 3)?.[1];
    if (alias && byName.get(alias)) return { name: titleCase(alias), region: byName.get(alias)!.region };
  }
  let best: { l: LocalityMatch; d: number } | null = null;
  for (const w of words) {
    for (const l of ALL) {
      const n = l.name.replace(/\s+/g, "");
      if (n.length < 6 || l.region === "outside") continue;
      // compare against same-length windows too, so a stray prefix ("san" + hinjawari) doesn't hide the match
      for (let len = n.length - 1; len <= n.length + 1; len++)
        for (let i = 0; i + len <= w.length; i++) {
          const d = lev(w.slice(i, i + len), n);
          if (d <= (n.length >= 8 ? 2 : 1) && (!best || d < best.d)) best = { l: { name: titleCase(l.name), region: l.region }, d };
        }
    }
  }
  return best?.l ?? null;
}
