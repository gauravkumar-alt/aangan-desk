// Turns what a caller says into structured facts. Shared by the demo voice agent (one utterance at a
// time) and by the Vaani webhook normaliser (collectedData values, which are often free text).
// Deliberately conservative: if a value isn't clearly said, it isn't captured.

import type { EnquiryFacts, ProjectType } from "./types";
import { findLocalities } from "./localities";

export type Slot =
  | "callerName"
  | "projectType"
  | "location"
  | "spaces"
  | "areaSqFt"
  | "projectStage"
  | "ownership"
  | "decisionMaker"
  | "timeline"
  | "laterStart"
  | "budget"
  | "landlord"
  | "fullService"
  | "phoneConfirm"
  | "anythingElse"
  | null;

export type BasicQuestion = "service_area" | "consultation" | "lead_time" | "hours" | "rented" | "services";

export interface Extraction {
  facts: Partial<EnquiryFacts>;
  unknown: (keyof EnquiryFacts)[];
  declined: (keyof EnquiryFacts)[];
  isCorrection: boolean;
  asksPrice: boolean;
  asksHuman: boolean;
  questions: BasicQuestion[];
  yes: boolean;
  no: boolean;
  goodbye: boolean;
  mentionsPriorContact: boolean; // "I called on Monday, nobody got back" (T16)
  offTopic: boolean; // a question with nothing to do with interiors ("why isn't Trump coming to my place?")
  abusive: boolean;
  phoneMentioned: string | null;
}

const WORD_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, both: 2, a: 1, an: 1, couple: 2, few: 3,
};

const NUM_WORDS = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand";
const NUM_RUN = new RegExp(`\\b(?:${NUM_WORDS})(?:[\\s-]+(?:and[\\s-]+)?(?:${NUM_WORDS}))*\\b`, "gi");

/** "fourteen hundred" → "1400", "two thousand four hundred" → "2400", "twenty five" → "25". Digits are left alone. */
export function wordsToDigits(input: string): string {
  return input.replace(NUM_RUN, (run) => {
    let total = 0;
    let cur = 0;
    for (const w of run.toLowerCase().split(/[\s-]+/)) {
      if (w === "and") continue;
      if (w === "hundred") cur = (cur || 1) * 100;
      else if (w === "thousand") {
        total += (cur || 1) * 1000;
        cur = 0;
      } else cur += WORD_NUM[w];
    }
    return String(total + cur);
  });
}

const num = (s: string) => Number(s.replace(/,/g, ""));
const has = (t: string, re: RegExp) => re.test(t);
const fmtInt = (n: number) => n.toLocaleString("en-IN");

// ---------- area ----------
export function parseArea(t: string, bare: boolean): { area: number; range: [number, number] | null } | null {
  const unit = String.raw`(?:sq\.?\s*(?:ft|feet|foot)|square\s*(?:feet|foot|ft|metres?)|sqft|sft|carpet|built[- ]?up)`;
  const n = String.raw`(\d[\d,]*(?:\.\d+)?)\s*(k)?`;
  const ranged = new RegExp(`${n}\\s*(?:-|–|to|or)\\s*${n}\\s*${unit}`, "i").exec(t);
  const kv = (v: string, k?: string) => num(v) * (k ? 1000 : 1);
  if (ranged) {
    const a = kv(ranged[1], ranged[2]);
    const b = kv(ranged[3], ranged[4]);
    if (a >= 100 && b >= 100) return { area: Math.round((a + b) / 2), range: [Math.min(a, b), Math.max(a, b)] };
  }
  const single = new RegExp(`${n}\\s*${unit}`, "i").exec(t);
  if (single) {
    const a = kv(single[1], single[2]);
    if (a >= 100 && a <= 50000) return { area: a, range: null };
  }
  if (bare) {
    // the agent just asked for the size: "about 1200", "maybe 1,000 or 1,200"
    const r = /(\d[\d,]{2,})\s*(?:-|–|to|or)\s*(\d[\d,]{2,})/.exec(t);
    if (r) {
      const a = num(r[1]);
      const b = num(r[2]);
      if (a >= 100 && b >= 100 && a <= 50000 && b <= 50000) return { area: Math.round((a + b) / 2), range: [Math.min(a, b), Math.max(a, b)] };
    }
    const s = /(?<![\d.])(\d[\d,]{2,})(?![\d.]|\s*(?:lakh|lac|l\b|crore|cr|k\b|rs|rupees|people|persons|seats|weeks|months|days))/i.exec(t);
    if (s) {
      const a = num(s[1]);
      if (a >= 100 && a <= 50000) return { area: a, range: null };
    }
  }
  return null;
}

// ---------- budget ----------
export function parseBudget(t: string): { min: number; max: number; text: string } | null {
  const re = /(?:₹|rs\.?|inr|rupees)?\s*(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|lacs|l|crore|crores|cr|k|thousand)?\s*(?:-|–|to)\s*(?:₹|rs\.?)?\s*(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|lacs|l|crore|crores|cr|k|thousand)\b|(?:₹|rs\.?|inr|rupees)?\s*(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|lacs|l|crore|crores|cr|k|thousand)\b/i;
  const m = re.exec(t);
  if (!m) return null;
  const mult = (u?: string) => {
    const x = (u || "").toLowerCase();
    if (x.startsWith("cr")) return 1e7;
    if (x.startsWith("l")) return 1e5;
    if (x === "k" || x === "thousand") return 1e3;
    return 0;
  };
  let min: number, max: number;
  if (m[3]) {
    const u2 = mult(m[4]);
    const u1 = mult(m[2]) || u2;
    min = Number(m[1]) * u1;
    max = Number(m[3]) * u2;
  } else {
    min = max = Number(m[5]) * mult(m[6]);
  }
  if (!min || !max) return null;
  const lakhs = (v: number) => (v >= 1e7 ? `${+(v / 1e7).toFixed(2)} crore` : `${+(v / 1e5).toFixed(2)} lakh`);
  const qualifier = /(max|maximum|at most|upto|up to|not more than|not flexible)/i.test(t) ? " (maximum)" : "";
  const text = min === max ? `₹${lakhs(min)}${qualifier}` : `₹${lakhs(min).replace(/ (lakh|crore)$/, "")}–${lakhs(max)}${qualifier}`;
  return { min, max, text };
}

// ---------- timeline ----------
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = new RegExp(`\\b(${MONTHS.join("|")}|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\\b`, "i");
const DIWALI: Record<number, string> = { 2025: "2025-10-20", 2026: "2026-11-08", 2027: "2027-10-29", 2028: "2028-10-17" };

function resolveMonth(token: string, now: Date, yearHint?: number): Date {
  const idx = MONTHS.findIndex((m) => m.startsWith(token.toLowerCase().slice(0, 3)));
  let year = yearHint ?? now.getFullYear();
  if (!yearHint && idx < now.getMonth()) year += 1;
  // "by March" = by the end of March
  return new Date(Date.UTC(year, idx + 1, 0));
}

export function parseTimeline(t: string, now: Date): Partial<EnquiryFacts> | null {
  const low = t.toLowerCase();
  const out: Partial<EnquiryFacts> = {};
  const flexible = /(no rush|not in a rush|flexible|plenty of time|whenever|no (specific )?deadline|no hurry)/.test(low);
  const asap = /(asap|as soon as possible|immediately|right away|start now|start right now|want to start now|urgent)/.test(low);
  const deadlineCue = /(by|before|done by|finished by|complete[d]? by|move (back )?in|moving in|operational|ready|in time for|guests|arriving|maximum|max|latest|deadline|until)/;
  const startCue = /(start|starting|begin|kick off|from)\b/;
  const possession = /possession/.test(low);

  const yearM = /\b(20\d{2})\b/.exec(low);
  const yearHint = yearM ? Number(yearM[1]) : undefined;
  const month = MONTH_RE.exec(low);
  // "in 6 weeks", "within three weeks", "3 weeks maximum" — but not "going for three months" (a duration in the past)
  const relRaw = /(?:\b(in|within|another|next|over the next)\s+(?:about\s+|around\s+|roughly\s+)?)?(\d+|a|one|two|three|four|five|six|seven|eight|nine|ten|twelve|couple of|few)\s*(week|weeks|month|months)(\s+(?:maximum|max|from now|away|time))?/.exec(wordsToDigits(low));
  const rel = relRaw && (relRaw[1] || relRaw[4]) ? [relRaw[0], relRaw[2], relRaw[3]] : null;

  if (/diwali/.test(low)) {
    const y = now.getFullYear();
    const d = DIWALI[y] && new Date(DIWALI[y]) > now ? DIWALI[y] : DIWALI[y + 1];
    if (/after diwali/.test(low)) {
      out.timeline = "Start after Diwali";
      out.timelineDeadline = null; // replaces any "before Diwali" deadline
      out.timelineFlexible = true;
    } else {
      out.timeline = "Done before Diwali";
      out.timelineDeadline = d;
    }
    return out;
  }

  const rel_month = /\b(?:by |within |before )?(?:the )?(?:end of )?(this|next) month\b/.exec(low);
  if (rel_month && !month && !possession) {
    const add = rel_month[1] === "next" ? 2 : 1;
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + add, 0)); // last day of that month
    out.timeline = `Done by the end of ${rel_month[1]} month`;
    out.timelineDeadline = d.toISOString().slice(0, 10);
  } else if (month) {
    const label = MONTHS.find((m) => m.startsWith(month[1].toLowerCase().slice(0, 3)))!;
    const d = resolveMonth(month[1], now, yearHint);
    const pretty = `${label[0].toUpperCase()}${label.slice(1)} ${d.getUTCFullYear()}`;
    const before = low.slice(0, month.index);
    const after = low.slice(month.index, month.index + 30);
    const isStart = startCue.test(before.slice(-30)) || /\bstart/.test(after);
    if (isStart && !/move|done|complete|ready|operational/.test(before.slice(-25))) {
      out.timeline = `Start ${pretty}`;
    } else if (possession && !deadlineCue.test(before.slice(-25))) {
      out.projectStage = `Possession ${pretty}`;
      out.siteAvailableDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
      return out;
    } else {
      const verb = /move (back )?in/.test(low) ? "Move in by" : /operational/.test(low) ? "Operational by" : "Done by";
      out.timeline = `${verb} ${pretty}`;
      out.timelineDeadline = d.toISOString().slice(0, 10);
    }
  } else if (rel) {
    const nRaw = rel[1];
    const n = /^\d+$/.test(nRaw) ? Number(nRaw) : nRaw.startsWith("couple") ? 2 : nRaw.startsWith("few") ? 3 : WORD_NUM[nRaw] ?? 1;
    const weeks = rel[2].startsWith("week") ? n : n * 4.35;
    const d = new Date(now.getTime() + weeks * 7 * 864e5);
    const unitLabel = `${n} ${rel[2].replace(/s$/, "")}${n === 1 ? "" : "s"}`;
    if (possession) {
      out.projectStage = `Possession in ~${unitLabel}`;
      out.siteAvailableDate = d.toISOString().slice(0, 10);
    } else if (startCue.test(low) && !deadlineCue.test(low)) {
      out.timeline = `Start in ~${unitLabel}`;
    } else {
      out.timeline = `Done within ~${unitLabel}`;
      out.timelineDeadline = d.toISOString().slice(0, 10);
    }
  }

  if (possession && /possession (is |will be )?next month|possession in a month/.test(low) && !out.siteAvailableDate) {
    out.projectStage = "Possession next month";
    out.siteAvailableDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 15)).toISOString().slice(0, 10);
  }
  if (asap && !out.timeline) out.timeline = "Start as soon as possible";
  if (flexible) {
    out.timelineFlexible = true;
    out.timeline = out.timeline ? `${out.timeline} (flexible)` : "Flexible — no fixed deadline";
  }
  return Object.keys(out).length ? out : null;
}

// ---------- spaces & scope ----------
// (Site availability lives with the timeline parser: "possession in six weeks" → siteAvailableDate.)
function parseSpaces(low: string): string[] {
  const s: string[] = [];
  const add = (x: string) => !s.includes(x) && s.push(x);
  const d = wordsToDigits(low);
  if (/modular kitchen/.test(low)) add("Modular kitchen");
  else if (/kitchen/.test(low)) add("Kitchen");
  if (/living|hall\b/.test(low)) add("Living room");
  if (/dining/.test(low)) add("Dining");
  const bedAll = /all (\d+|four|three|two) bed ?rooms?/.exec(d);
  const bedBoth = /both (the )?bed ?rooms?/.test(low);
  const bedN = /(\d+|one|two|three|four)\s+bed ?rooms?/.exec(d);
  if (/master bed ?room/.test(low)) add("Master bedroom");
  if (bedAll) add(`All ${bedAll[1]} bedrooms`);
  else if (bedBoth) add("Both bedrooms");
  else if (bedN && !/bhk/.test(d.slice(Math.max(0, (bedN.index ?? 0) - 5), (bedN.index ?? 0) + 15))) add(`${bedN[1]} bedroom${bedN[1] === "1" || bedN[1] === "one" ? "" : "s"}`);
  else if (/\bbed ?rooms?\b/.test(low) && !/master bed ?room/.test(low)) add("Bedroom");
  if (/wardrobe/.test(low)) add("Wardrobes");
  if (/home office|work ?space at home|office corner|study/.test(low)) add("Study / home office");
  if (/(pooja|puja) (room|space|corner|unit)|mandir/.test(low)) add("Pooja room");
  if (/balcon/.test(low)) add("Balcony");
  if (/bath ?rooms?|toilets?/.test(low)) add("Bathrooms");
  if (/floor(ing)?\b/.test(low) && /new floor|flooring/.test(low)) add("Flooring");
  const ws = /workstations?(?: for)? (\d+)|(\d+) workstations?|(\d+) (?:people|seats|employees)/.exec(d);
  if (ws) add(`Workstations (${ws[1] || ws[2] || ws[3]})`);
  else if (/workstations?|desks for/.test(low)) add("Workstations");
  const cab = /(\d+|a|one|two|three|four) (?:small )?cabins?/.exec(d);
  if (cab) add(`Cabin${cab[1] !== "a" && cab[1] !== "1" && cab[1] !== "one" ? `s (${cab[1]})` : ""}`);
  else if (/cabin/.test(low)) add("Cabin");
  if (/meeting rooms?|conference/.test(low)) add("Meeting room");
  if (/boardroom/.test(low)) add("Boardroom");
  if (/break (area|room)|pantry|cafeteria/.test(low)) add("Break area / pantry");
  if (/reception/.test(low)) add("Reception");
  if (/lounge/.test(low)) add("Lounge");
  return s;
}

const FULL_RE = /(whole (thing|house|home|flat|place|apartment)|full (home|house|flat|redesign|interiors?|package|fit-?out|thing)|complete (redesign|interiors?|home|fit-?out|makeover)|entire (house|home|flat|apartment|place)|everything|end[- ]to[- ]end|from scratch|all (the )?rooms|full[- ]?scope|full design)/;
const ADVISORY_RE = /((just|only) (want |need |looking for )?(some )?(suggestions|ideas|advice|tips)|consultation[- ]only|advisory|not (planning|looking) to do the (full|whole) thing|give us some ideas|colou?rs?,? furniture arrangement|just (a )?(design )?advice)/;

// ---------- project type ----------
function parseProjectType(low: string): { type: ProjectType; property: string | null } | null {
  const l = low.replace(/aangan studio/g, "");
  if (/(restaurant|\bcafe\b|café|\bbar\b|hotel|hospitality|banquet|\bpub\b|bakery|cloud kitchen)/.test(l)) return { type: "hospitality", property: l.match(/restaurant|cafe|café|hotel|banquet|bar|pub|bakery|cloud kitchen/)![0] };
  if (/(\bgym\b|fitness cent|crossfit)/.test(l)) return { type: "fitness", property: "Gym" };
  if (/(\bshop\b|retail|showroom|boutique|\bstore\b)/.test(l)) return { type: "retail", property: l.match(/shop|retail|showroom|boutique|store/)![0] };
  if (/(clinic|dental|dentist|physio|diagnostic cent)/.test(l)) return { type: "clinic", property: "Clinic" };
  if (/(yoga studio|dance studio|pilates|salon|\bspa\b|parlour|parlor|school|hospital|coaching (class|cent))/.test(l)) return { type: "other_commercial", property: l.match(/yoga studio|dance studio|pilates|salon|spa|parlour|parlor|school|hospital|coaching (class|centre|center)/)![0] };
  if (/(photo(graphy)? studio|design studio|recording studio|art studio|architecture studio|podcast studio|(my|our|a) studio\b(?! apartment| flat))/.test(l)) return { type: "studio", property: "Studio" };
  if (/(office|workspace|work space|startup|start-up|co-?working|workstations|commercial fit|our company|corporate)/.test(l) && !/home office|office corner/.test(l)) {
    return { type: "office", property: /co-?working/.test(l) ? "Coworking space" : "Office" };
  }
  const bhk = /(\d)\s*-?\s*bhk/.exec(wordsToDigits(l));
  if (/villa|bungalow/.test(l)) return { type: "residential", property: "Villa" };
  if (/row ?house/.test(l)) return { type: "residential", property: "Row house" };
  if (/independent house/.test(l)) return { type: "residential", property: "Independent house" };
  if (/penthouse/.test(l)) return { type: "residential", property: "Penthouse" };
  if (/studio (apartment|flat)/.test(l)) return { type: "residential", property: "Studio apartment" };
  if (bhk) return { type: "residential", property: `${bhk[1]}BHK apartment` };
  const homeless = low.replace(/(work(ing)? from home|wfh|from home currently|home office)/g, "");
  if (/(flat|apartment|\bhome\b|\bhouse\b|my place|our place|residence|duplex)/.test(homeless)) return { type: "residential", property: /duplex/.test(low) ? "Duplex" : /flat|apartment/.test(low) ? "Apartment" : null };
  return null;
}

function parseStage(low: string): string | null {
  if (/bare shell|shell and core|warm shell|just columns/.test(low)) return "Bare shell";
  if (/under construction/.test(low)) return "Under construction";
  if (/new construction|new build|newly built/.test(low)) return "New construction";
  if (/(just got|got|getting|taking|new) possession|possession (was )?last|builder (flat|handover)|completely (empty|bare)|flat is empty|brand new/.test(low)) return "New possession";
  if (/(lived here|been here|living here|moved in|we live|staying here|for \d+ years)/.test(low)) return "Lived-in (renovation)";
  if (/renovat|redo|re-do|makeover|still looks like the builder/.test(low)) return "Renovation";
  return null;
}

const NAME_STOP = new Set(
  "calling looking planning not in from just sure the a an interested ok okay fine good renting flexible here there thinking trying wondering hoping actually also ready new moving getting sorry speaking talking going having asking still only very really so well yes no hi hello namaste been about my for at with your our their this that it is was we us own you they he she i me mine ours rent rented".split(" "),
);

function cleanName(raw: string, requireCaps: boolean): string | null {
  const words = raw
    .replace(/[^A-Za-z\s'-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  const kept: string[] = [];
  for (const w of words) {
    // "I'm doing the checking", "it's been two days" — verbs and fillers aren't names
    if (NAME_STOP.has(w.toLowerCase()) || /ing$/i.test(w) || w.length < 2) break;
    // When the text has normal capitalisation (typed / transcribed), a name starts with a capital.
    if (requireCaps && !/^[A-Z]/.test(w)) break;
    kept.push(w[0].toUpperCase() + w.slice(1).toLowerCase());
    if (kept.length === 2) break;
  }
  return kept.length ? kept.join(" ") : null;
}

function parseName(t: string, bare: boolean): string | null {
  const requireCaps = /[A-Z]/.test(t.replace(/^\W*\w/, "").replace(/\bI\b|\bI'm\b|\bI’m\b/g, ""));
  const m = /(?:\bmy name is|\bmy name's|\bthis is|\bi am|\bi'm|\bi’m|\bname's|\bit's|\bit’s|\bmyself)\s+([A-Za-z][A-Za-z'.-]+(?:\s+[A-Za-z][A-Za-z'.-]+)?)/i.exec(t);
  if (m) {
    const cand = cleanName(m[1], requireCaps);
    // "this is for my parents", "I'm in Nashik", "I'm calling" — the stop list catches most; reject places
    if (cand && !findLocalities(cand).length && !/^(for|about|regarding|with|the)$/i.test(cand.split(" ")[0])) return cand;
  }
  if (bare) {
    // Answer to "may I have your name?": "Girish Nair. I called Monday…" → first segment
    const first = t.replace(/^(yes|yeah|sure|ok(ay)?|hi|hello)[,.!\s]+/i, "").split(/[.,!?;—–]/)[0].trim();
    const words = first.replace(/^(it'?s|i'?m|this is|my name is)\s+/i, "");
    if (words.split(/\s+/).length <= 3 && /^[A-Za-z][A-Za-z'\s-]+$/.test(words)) return cleanName(words, false);
  }
  return null;
}

const UNKNOWN_RE = /(don'?t know|don’t know|not sure|no idea|unsure|can'?t say|haven'?t (measured|checked|decided)|not decided|no clue|not certain|no fixed|haven'?t thought)/;
const DECLINE_RE = /(rather not|prefer not|don'?t want to (say|share|tell)|won'?t say|not comfortable|that'?s private|will discuss (it )?(at|in|during) the consultation|discuss (that |it )?(later|at the consultation)|skip (that|this|it)|pass on that)/;

const SLOT_FIELDS: Partial<Record<NonNullable<Slot>, (keyof EnquiryFacts)[]>> = {
  callerName: ["callerName"],
  projectType: ["projectType"],
  location: ["location"],
  spaces: ["spaces"],
  areaSqFt: ["areaSqFt"],
  projectStage: ["projectStage"],
  ownership: ["ownership"],
  decisionMaker: ["decisionMaker"],
  timeline: ["timeline"],
  budget: ["budget"],
};

function topicOf(low: string): (keyof EnquiryFacts) | null {
  if (/(size|area|square|sq|big|carpet)/.test(low)) return "areaSqFt";
  if (/(budget|spend|afford|money)/.test(low)) return "budget";
  if (/(timeline|when|date|deadline|start)/.test(low)) return "timeline";
  if (/(name)/.test(low)) return "callerName";
  return null;
}

/** "tomorrow at 7:00 p.m.", "after 6 in the evening", "weekday mornings" → "tomorrow around 7pm". */
export function parseCallbackTime(t: string): string | null {
  const low = t.toLowerCase().replace(/\./g, "");
  const day = /(today|tonight|tomorrow|day after tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|weekday)s?/.exec(low)?.[1] ?? null;
  const tm = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(low);
  const part = /(morning|afternoon|evening|night|lunch)/.exec(low)?.[1] ?? null;
  const after = /\b(after|before|around|by)\b/.exec(low)?.[1] ?? null;
  if (!day && !tm && !part) return null;
  const time = tm ? `${tm[1]}${tm[2] && tm[2] !== "00" ? `:${tm[2]}` : ""}${tm[3]}` : part ? `in the ${part}` : null;
  return [day, time ? `${after ?? (tm ? "around" : "")} ${time}`.trim() : null].filter(Boolean).join(" ");
}

export function extract(text: string, ctx: { lastAsked: Slot; now: Date }): Extraction {
  const t = text.trim();
  const low = t.toLowerCase().replace(/’/g, "'");
  const digits = wordsToDigits(low);
  const facts: Partial<EnquiryFacts> = {};
  const unknown: (keyof EnquiryFacts)[] = [];
  const declined: (keyof EnquiryFacts)[] = [];
  const questions: BasicQuestion[] = [];

  const yes = /^(yes|yeah|yep|yup|ya|sure|ok|okay|haan|han|ha|correct|right|that's right|absolutely|of course|definitely|please|go ahead|works|fine|perfect|great|sounds good)\b/.test(low) || /\b(yes|yeah|sure)\b/.test(low.slice(0, 20));
  const no = /^(no|nope|nah|not really|na|not at all|nahi)\b/.test(low);
  const goodbye = /(\bbye\b|that's all|nothing else|that's it|no,? that's (all|it)|no thanks|i'?m done)/.test(low);
  const isCorrection = /\b(actually|sorry,? (i meant|i mean|it's|its)|i meant|no wait|wait,? no|correction|let me correct|make that|not .{1,20} but|instead of|change (that|it) to|i said .{1,20} but)\b/.test(low);
  const asksPrice = /(how much|what (would|will|might|does) (it|that|this|something like that) cost|cost me|ballpark|rough (range|idea|estimate|number|figure|cost)|rough(ly)? how much|per (sq|square)|your (rates?|charges|pricing|price)|what do you charge|price list|pricing|estimate|indicative|quote)/.test(low);
  const asksHuman = /((speak|talk) (to|with) (a |an )?(person|human|someone|somebody|designer|nikhil|manager|real)|real person|human being|actual person)/.test(low);

  if (/(which areas|where do you (work|operate)|do you (come|work|operate) (to|in)|service area|outside pune)/.test(low)) questions.push("service_area");
  if (/(consultation (is )?free|charge for (the )?consultation|consultation fee|free consultation\?)/.test(low)) questions.push("consultation");
  if (/(how long (does|will|would) (it|this|that|a project)|how much time)/.test(low)) questions.push("lead_time");
  if (/(timings|what are your hours|when are you open|office hours|working hours)/.test(low)) questions.push("hours");
  if (/(rented|renting|tenant).*\?|can you (still )?(take|do).*(rent)/.test(low)) questions.push("rented");
  if (/(what (all )?do you do|what services|do you (do|take up|handle|design) )/.test(low)) questions.push("services");

  // intent
  if (/((my|our) designer\b.{0,40}(hasn't|has not|not|isn't|didn't|no)|existing project|ongoing project|my project (has been|is) (going|running|delayed)|you('re| are) (doing|working on) (my|our)|complaint|not (getting )?(a )?(reply|response) from (my|our) designer)/.test(low)) facts.intent = "existing_client";

  // name
  const name = parseName(t, ctx.lastAsked === "callerName");
  if (name) facts.callerName = name;

  // project type / property
  const pt = parseProjectType(digits);
  if (pt) {
    facts.projectType = pt.type;
    if (pt.property) facts.propertyType = pt.property;
  }
  const bhk = /(\d)\s*-?\s*bhk/.exec(digits);
  if (bhk && !facts.propertyType) facts.propertyType = `${bhk[1]}BHK apartment`;

  // location — ignore places in sentences about someone else's home ("she had her flat done by you in Aundh")
  const ownSentences = t.split(/(?<=[.!?])\s+/).filter((x) => !/(\b(her|his|their)\b (flat|home|house|place|office)|friend'?s (flat|home|house)|done by you|you did (her|his|their|my friend))/i.test(x)).join(" ");
  const locs = findLocalities(ownSentences);
  if (locs.length) {
    const top = locs[0];
    facts.location = top.region === "Pune" || top.region === "PCMC" ? (top.name === "Pune" || top.name === "PCMC" ? top.name : `${top.name}, ${top.region === "PCMC" ? "PCMC" : "Pune"}`) : top.name;
    facts.locationStatus = top.region === "outside" ? "outside" : top.region === "nearby" ? "unrecognised" : "in_area";
  } else if (ctx.lastAsked === "location" && !UNKNOWN_RE.test(low) && !DECLINE_RE.test(low) && t.length < 60) {
    // A place we don't recognise — keep the caller's words; a person will check it.
    const place = t.replace(/^(it'?s |we'?re |i'?m |in |at |near |it is )+/i, "").replace(/[.!?]$/, "").trim();
    if (place && !/^(yes|no|ok|okay)$/i.test(place)) {
      facts.location = place.replace(/\b\w/g, (c) => c.toUpperCase());
      facts.locationStatus = "unrecognised";
    }
  }

  // area (don't read budget numbers or headcounts as area)
  const area = parseArea(digits, ctx.lastAsked === "areaSqFt");
  if (area) {
    facts.areaSqFt = area.area;
    facts.areaSqFtRange = area.range;
  }

  // spaces & scope
  const spaces = parseSpaces(low);
  if (spaces.length) facts.spaces = spaces;
  if (ADVISORY_RE.test(low)) facts.scope = "advisory";
  else if (FULL_RE.test(low)) facts.scope = "full";
  else if (spaces.length) {
    const hasKitchen = spaces.some((s) => /kitchen/i.test(s));
    const hasLiving = spaces.includes("Living room");
    const hasBed = spaces.some((s) => /bedroom|wardrobe/i.test(s));
    // T17: "Kitchen, wardrobes, living room" → front desk: "Standard full-home scope."
    facts.scope = hasKitchen && hasLiving && hasBed ? "full" : "partial";
  }
  if (ctx.lastAsked === "fullService") {
    if (yes || /(design and execution|full (project|execution)|execution too|both)/.test(low)) facts.scope = facts.scope && facts.scope !== "advisory" ? facts.scope : "full";
    else if (no) facts.scope = "advisory";
  }

  const stage = parseStage(low);
  if (stage) facts.projectStage = stage;

  // services.md › What we don't do
  if (/(furniture sourcing|(just|only) (need |want |looking for )?(some )?(furniture|a sofa|a few pieces)|(buy|procure|source) (some |the )?furniture (for|only))/.test(low)) facts.notOffered = "furniture_only";
  else if (/(vastu (consultation|consultant|advice|check|audit)|only vastu|just vastu)/.test(low) && !/(vastu[- ]compliant|follow vastu|as per vastu|vastu too)/.test(low)) facts.notOffered = "vastu_only";
  else if (/((do|handle|manage) (the )?(execution|work|civil work) (ourselves|myself)|(have|got) (my|our|a) own contractor|(just|only) (need |want )?(the )?designs?( only)?\b(?! and| \+| with)|design[- ]only|only the design)/.test(low)) facts.notOffered = "diy_execution";
  else if (/(styling|decor) only|(just|only) (some )?(styling|decor|decoration)|rearrange (the )?furniture|furniture arrangement|suggest (some )?colou?rs/.test(low)) facts.notOffered = "decor_only";
  if (facts.notOffered && facts.notOffered !== "diy_execution") facts.scope = "advisory";

  if (/(luxur)/.test(low)) facts.specTier = "luxury";
  else if (/(premium|high[- ]end|top[- ]end|imported)/.test(low)) facts.specTier = "premium";
  else if (/\bstandard (spec|specification|finish|materials)/.test(low)) facts.specTier = "standard";

  // ownership / decision maker / structural
  if (/\b(rent(ed|ing)?|on lease|leased|lease|tenant|landlord)\b/.test(low) && !/(not rented|own it)/.test(low)) facts.ownership = "rented";
  else if (/\bfor my (parents|mother|father|mom|dad|mum|in-laws)\b|my parents('s)? (flat|home|house|place)|parents have/.test(low)) facts.ownership = "family";
  else if (/\b(i own|we own|our own|my own|owner|we bought|i bought|bought (it|a|the)|own (the|this|it))\b/.test(low) || (ctx.lastAsked === "ownership" && yes && !/rent/.test(low))) facts.ownership = "owner";

  if (/(happy to go ahead|knows (we're|i'm) calling|i'm the (founder|owner|decision[- ]maker|director|md|ceo|co-founder)|i make the decision|i('ll| will) (decide|be deciding)|my (husband|wife) and i|myself and my (husband|wife|partner)|(he|she) said to go ahead|we('re| are) both (deciding|going to be there)|we both want to be at|decision[- ]maker)/.test(low)) facts.decisionMaker = "yes";
  // qualified.md › 5: "calling on behalf of someone who has authorised them" is fine; "just doing initial research
  // for my in-laws" is not sufficient on its own.
  const forFamily = /\bfor my (parents|mother|father|mom|dad|mum|in-?laws|brother|sister|uncle|aunt|boss)|on (his|her|their) behalf|my (parents|in-?laws)('s)? (flat|home|house|place)/.test(low);
  const research = /((just|only) (doing )?(some |initial |a bit of )?(research|checking|enquiring)|(doing|did) (the )?initial (research|checking)|just (calling|checking) to see|gathering (some )?information|just finding out)/.test(low);
  if (research && (forFamily || ctx.lastAsked === "decisionMaker")) facts.decisionMaker = "no";
  if (/(they('ll| will) (come|attend|be there)|(they|both) would come|parents (will|would) (come|attend|be there)|they('ll| will) decide)/.test(low)) facts.decisionMaker = "family_attending";
  if (/(asked me to (go ahead|book|arrange|set (it|this) up|take it forward)|told me to go ahead|(i'?m|i am|i've been) (authori[sz]ed|allowed) to|(he|she|they)('s| is| are)? (fine|okay|happy) (for me )?to go ahead|i can (decide|go ahead) on (his|her|their) behalf)/.test(low) && facts.decisionMaker !== "yes") facts.decisionMaker = "authorised";
  if (/(not my decision|i'?m not the decision|someone else (decides|will decide)|i can'?t decide|(boss|management|board) (decides|will decide)|they won'?t be able to come|not authori[sz]ed)/.test(low)) facts.decisionMaker = "no";
  if (ctx.lastAsked === "decisionMaker" && !facts.decisionMaker) {
    if (yes) facts.decisionMaker = facts.ownership === "family" || forFamily ? "authorised" : "yes";
    else if (no) facts.decisionMaker = "no";
  }

  if (/(no structural|don'?t break walls|without breaking|no wall|not break(ing)? (any )?walls|nothing structural|reversible)/.test(low)) facts.structuralChanges = false;
  else if (/(break(ing)? (a |the |down )?walls?|knock (down|out)|structural changes?|remove (a |the )?wall|move the kitchen|combine (two )?rooms)/.test(low)) facts.structuralChanges = true;
  if (/landlord (is|are|was) (fine|ok|okay|happy)|landlord agreed|permission from (the )?landlord/.test(low) || (ctx.lastAsked === "landlord" && (yes || /(they'?re|he'?s|she'?s) (fine|ok|okay|happy)/.test(low))))
    facts.constraints = facts.structuralChanges === true ? "Landlord consulted — caller wants structural changes." : "Landlord has agreed (no structural changes).";

  // exploring
  if (/(just exploring|only exploring|just looking|still (very )?early|early stage|maybe later|not ready yet|not planning (to do )?(it|anything) (right )?now|just checking (prices|rates)|just (want(ed)? )?to (get )?(a feel|an idea))/.test(low)) facts.exploring = true;
  if (/(ready to (go ahead|commit|start|book)|want to start (now|right away|immediately)|let'?s book|book (it|a consultation))/.test(low)) facts.exploring = false;

  // referral
  const ref = /((?:got your (?:number|name|details) from|referred (?:by|from)|recommended by|reference from)\s+[^.,;]+|[A-Z][a-z]+(?: [A-Z][a-z]+)? (?:asked|told|suggested|recommended) (?:me|us) to (?:call|reach|contact)|friend of nikhil'?s?|nikhil'?s (?:close )?friend|close friend of nikhil'?s?)/i.exec(t.replace(/’/g, "'"));
  if (ref) facts.referral = ref[1].trim().replace(/[.—–-]+$/, "");
  else if (/(instagram|linkedin|google|facebook|youtube)/.test(low) && /(saw|found|seen|looking at|came across|on)/.test(low)) facts.referral = `Found us on ${low.match(/instagram|linkedin|google|facebook|youtube/)![0].replace(/^\w/, (c) => c.toUpperCase())}`;

  // timeline & budget
  const tl = ctx.lastAsked === "phoneConfirm" ? null : parseTimeline(t, ctx.now);
  if (tl) Object.assign(facts, tl);
  if (ctx.lastAsked === "laterStart") {
    if (yes || /(later|after|that works|can wait|can move|push it)/.test(low)) {
      facts.timelineFlexible = true;
      if (!tl?.timeline) facts.timeline = "Open to a later start";
      facts.timelineDeadline = tl?.timelineDeadline ?? null;
    } else if (no) facts.timelineFlexible = false;
  }
  const budget = parseBudget(digits);
  if (budget) {
    facts.budget = budget.text;
    facts.budgetMinInr = budget.min;
    facts.budgetMaxInr = budget.max;
  }

  // when to call back — only when we're asking about it, or clearly phrased ("call me tomorrow at 7pm")
  if (ctx.lastAsked === "phoneConfirm" || /(call|reach|contact|ring) (me|us)|best time|available (at|after|before|in the)/.test(low)) {
    const cb = parseCallbackTime(t);
    if (cb) facts.callbackPreference = cb;
  }

  // requirements: style/material words worth passing on verbatim
  const style = /(warm|earthy|minimal|minimalist|modern|contemporary|traditional|scandinavian|industrial|luxur|premium|high-energy|vastu|boho|classic|natural light|storage|kid'?s room|elderly|pet)[^.?!]*/i.exec(t);
  if (style) facts.requirements = style[0].trim();

  // "I don't know" / "rather not say" → attach to the topic mentioned, else to the question just asked
  const target = topicOf(low) ?? (ctx.lastAsked ? SLOT_FIELDS[ctx.lastAsked]?.[0] ?? null : null);
  if (DECLINE_RE.test(low) && target && !(target in facts)) declined.push(target);
  else if (UNKNOWN_RE.test(low) && target && !(target in facts)) unknown.push(target);

  const mentionsPriorContact = /(called (you )?(before|earlier|on (mon|tues|wednes|thurs|fri|satur|sun)day|yesterday|last week)|someone said they('d| would) (get back|call)|no ?one (called|got|has got) back|still waiting|never (heard|got a call) back|messaged .{0,20}ago)/.test(low);
  const ph = /(\+?\d[\d\s-]{8,}\d)/.exec(t);
  const phoneMentioned = ph ? ph[1].replace(/[\s-]/g, "") : null;

  // Off-topic: a question, nothing project-related extracted, not one of the questions we answer.
  const isQuestion = /\?\s*$/.test(t) || /^(why|what|who|how|when|where|is|are|can|could|will|would|do|does|tell me)\b/.test(low);
  // "my place"/"my home" alone doesn't make it a project question ("why isn't Trump coming to my place?")
  const projectish = /(interior|design|bhk|flat|apartment|villa|office|clinic|kitchen|bedroom|living room|wardrobe|aangan|consultation|designer|project|renovat|redo|sq ?ft|square feet|price|cost|budget)/.test(low);
  const weakOnly = Object.keys(facts).every((k) => ["projectType", "propertyType", "callerName"].includes(k));
  const introducing = Boolean(facts.callerName) || /\b(this is|i am|i'm|my name)\b/.test(low);
  const offTopic = isQuestion && !introducing && !projectish && weakOnly && !asksPrice && !asksHuman && !questions.length;
  if (offTopic) for (const k of Object.keys(facts)) delete (facts as Record<string, unknown>)[k];
  const abusive = /\b(fuck|shit|bitch|bastard|idiot|stupid|chutiya|madarchod|bhenchod)\b/.test(low);

  return { facts, unknown, declined, isCorrection, asksPrice, asksHuman, questions, yes, no, goodbye, mentionsPriorContact, phoneMentioned, offTopic, abusive };
}

export const fmtSqFt = (n: number) => `${fmtInt(n)} sq ft`;
