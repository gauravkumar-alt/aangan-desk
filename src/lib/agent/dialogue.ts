// Demo-mode conversation engine. In production the conversation is run by the Vaani agent using
// vaani/agent-prompt.md; this engine follows the same policy so the demo behaves like the real thing:
// ANSWER → UNDERSTAND → QUALIFY → INFORM → HAND OFF.
//
// Policy, from the case files:
//   • qualified.md: unclear on #1–3 → ask ONE direct question; never probe budget; don't push on #5;
//     a failed criterion → close gracefully; two or more → the rubric's own decline line.
//   • pricing.md: never say a number. The only answer to a pricing question is the approved line.
//   • Never re-ask what the caller answered, didn't know, or declined.

import { extract, type Slot } from "../extract";
import { mergeFacts } from "../facts";
import { isWithinHours } from "../hours";
import { budgetFloor, callerPriceResponse, indicativePrice } from "../pricing";
import { qualify } from "../qualify";
import type { Ruleset } from "../rules/schema";
import type { Correction, EnquiryFacts, TranscriptTurn } from "../types";
import { EMPTY_FACTS } from "../types";

export interface DialogueState {
  facts: EnquiryFacts;
  unknown: string[];
  declined: string[];
  asked: string[];
  lastAsked: Slot | "locationConfirm";
  corrections: Correction[];
  turns: TranscriptTurn[];
  startedAt: string;
  priceAsked: number;
  humanAsks: number;
  retries: string[]; // questions re-asked once after an answer we couldn't make out
  offTopicCount: number;
  repeatCaller: boolean;
  altPhone: string | null;
  phase: "talking" | "wrapping" | "ended";
  endReason: "completed" | "not_a_fit" | "escalated" | "caller_left" | null;
}

const istHour = (d: Date) => new Date(d.getTime() + 330 * 60_000).getUTCHours();
const pick = <T,>(xs: T[], seed: number) => xs[seed % xs.length];
const firstName = (f: EnquiryFacts) => (f.callerName ? `, ${f.callerName.split(" ")[0]}` : "");

export function startDialogue(now: Date, rules: Ruleset): { state: DialogueState; reply: string } {
  const open = isWithinHours(now, rules.services.rules?.hours);
  const h = istHour(now);
  const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const reply = `${greet}, Aangan Studio. I'm the studio's virtual assistant${open ? "" : " — the studio's closed right now, but I can help"}. How can I help you today?`;
  return {
    reply,
    state: {
      facts: { ...EMPTY_FACTS, spaces: [] },
      unknown: [],
      declined: [],
      asked: [],
      lastAsked: null,
      corrections: [],
      turns: [{ role: "AGENT", text: reply, atMs: 0 }],
      startedAt: now.toISOString(),
      priceAsked: 0,
      humanAsks: 0,
      retries: [],
      offTopicCount: 0,
      repeatCaller: false,
      altPhone: null,
      phase: "talking",
      endReason: null,
    },
  };
}

type Ask = Exclude<Slot, null> | "locationConfirm";

/** What a good front-desk person still needs, in order. Budget is never on the list (qualified.md › 4). */
function plan(f: EnquiryFacts): Ask[] {
  if (!f.projectType) return ["projectType", "callerName", "location", "spaces", "timeline"];
  const commercial = f.projectType !== "residential";
  if (commercial) return ["callerName", "location", "areaSqFt", "spaces", "timeline"];
  const p: Ask[] = ["callerName", "location", "spaces", "areaSqFt", "ownership"];
  if (f.ownership === "rented") p.push("landlord");
  if (f.ownership === "family") p.push("decisionMaker");
  p.push("timeline");
  return p;
}

function have(s: DialogueState, slot: Ask): boolean {
  const f = s.facts;
  const v: Record<string, unknown> = {
    callerName: f.callerName,
    projectType: f.projectType,
    location: f.location,
    spaces: f.spaces.length || f.scope ? true : null,
    areaSqFt: f.areaSqFt,
    ownership: f.ownership,
    decisionMaker: f.decisionMaker,
    timeline: f.timeline || f.timelineDeadline,
    landlord: f.constraints || f.structuralChanges !== null ? true : null,
  };
  return v[slot] != null || s.unknown.includes(slot) || s.declined.includes(slot) || s.asked.includes(slot);
}

function question(slot: Ask, s: DialogueState, rules: Ruleset, seed: number): string {
  const f = s.facts;
  const crit = (id: string) => rules.qualified.rules?.criteria.find((c) => c.id === id)?.question;
  const place = f.projectType && f.projectType !== "residential" ? `the ${f.projectType === "other_commercial" ? "space" : f.projectType}` : f.propertyType?.includes("BHK") ? "the flat" : f.propertyType === "Villa" ? "the villa" : "the property";
  switch (slot) {
    case "projectType":
      return "Is this for a home, or a commercial space like an office or clinic?";
    case "callerName":
      return pick(["May I know who I'm speaking with?", "And may I have your name, please?"], seed);
    case "location":
      return f.projectType && f.projectType !== "residential" ? `Where is ${place}?` : `Which part of Pune is ${place} in?`;
    case "locationConfirm":
      return crit("c2_service_area") ?? "Is that within Pune city or PCMC?";
    case "spaces":
      return f.projectType && f.projectType !== "residential" ? "What do you need in the space — workstations, cabins, a reception?" : "What are you thinking of doing — the whole home, or particular rooms?";
    case "areaSqFt":
      return `Roughly how big is ${place} — do you know the carpet area in square feet?`;
    case "ownership":
      return "Is this your own home, or are you renting?";
    case "landlord":
      return "That's fine — we do rented homes, as long as there are no structural changes. Is your landlord okay with the work?";
    case "decisionMaker":
      return "Have they asked you to go ahead with it, or are you gathering information for them for now?";
    case "timeline":
      return crit("c3_timeline") ?? "When would you need the project complete?";
    case "fullService":
      return `Our projects are design and execution together — the smallest is a room redesign with execution. ${crit("c1_real_project") ?? "Would you be looking at design and execution together?"}`;
    case "laterStart":
      return "Would a later completion date work for you?";
    default:
      return "";
  }
}

function acknowledge(before: EnquiryFacts, after: EnquiryFacts, ext: ReturnType<typeof extract>, corr: Correction[], s: DialogueState): string[] {
  const out: string[] = [];
  for (const c of corr) {
    const fmt = (v: string) => (c.field === "areaSqFt" ? `${Number(v).toLocaleString("en-IN")} square feet` : v);
    out.push(`Got it — ${fmt(c.to)}, not ${fmt(c.from)}.`);
  }
  if (corr.length) return out;
  const n = s.turns.length;
  if (!before.callerName && after.callerName) out.push(pick([`Thanks, ${after.callerName.split(" ")[0]}.`, `Nice to meet you, ${after.callerName.split(" ")[0]}.`], n));
  if (!before.location && after.location && after.locationStatus === "in_area") out.push(pick([`${after.location.split(",")[0]} — great.`, `Got it, ${after.location.split(",")[0]}.`], n));
  if (!before.scope && after.scope === "full") out.push(after.projectType && after.projectType !== "residential" ? "A full fit-out, got it." : pick(["The whole home — got it.", "Great, the whole home."], n));
  else if (!before.spaces.length && after.spaces.length && after.scope === "partial") out.push(`The ${after.spaces.join(", ").toLowerCase()} — got it.`);
  if (!before.areaSqFt && after.areaSqFt) out.push(after.areaSqFtRange ? "Somewhere in that range — that's fine." : `${after.areaSqFt.toLocaleString("en-IN")} square feet, perfect.`);
  if (after.structuralChanges && !before.structuralChanges) out.push("Just so you know, we don't do structural work like moving walls — we're interior designers, not architects. Everything else we can take care of.");
  for (const u of ext.unknown) out.push(u === "areaSqFt" ? "No problem at all — the designer will measure it at the site visit." : "That's absolutely fine.");
  if (ext.declined.length) out.push("Of course, no problem.");
  if (!out.length && s.turns.length > 2 && ext.isCorrection === false && Object.keys(ext.facts).length) out.push(pick(["Got it.", "Okay.", "Right."], s.turns.length));
  return out.slice(0, 2);
}

function answerBasics(qs: string[], rules: Ruleset): string[] {
  const svc = rules.services.rules;
  if (!svc) return [];
  const out: string[] = [];
  if (qs.includes("service_area")) out.push(`We work across Pune city and PCMC.`);
  if (qs.includes("lead_time")) out.push(`Design takes about ${svc.leadTimes.designPhaseWeeks.join("–")} weeks, and execution ${svc.leadTimes.executionWeeks.join("–")} weeks depending on the size and the site.`);
  if (qs.includes("hours")) out.push(`The studio is in from ${fmt12(svc.hours.open)} to ${fmt12(svc.hours.close)}, but I'm here any time.`);
  if (qs.includes("rented")) out.push("Yes — a rented home is fine, as long as there are no structural changes.");
  if (qs.includes("services")) out.push("We do end-to-end interiors for homes and small commercial spaces like offices and clinics — design and execution together.");
  if (qs.includes("identity")) out.push("I'm Aangan Studio's virtual assistant — an AI that takes enquiries so a designer can call you back with everything already noted.");
  if (qs.includes("consultation")) out.push("Your designer will go through everything with you at the consultation.");
  return out;
}

const fmt12 = (hhmm: string) => {
  const h = Number(hhmm.split(":")[0]);
  return `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
};

export function step(prev: DialogueState, callerText: string, rules: Ruleset, now: Date): { state: DialogueState; reply: string; ended: boolean } {
  const s: DialogueState = structuredClone(prev);
  const atMs = now.getTime() - new Date(s.startedAt).getTime();
  s.turns.push({ role: "CALLER", text: callerText, atMs });
  const say = (text: string, end = false) => {
    const t = text.replace(/\s+/g, " ").trim();
    s.turns.push({ role: "AGENT", text: t, atMs: atMs + 400 });
    if (end) s.phase = "ended";
    return { state: s, reply: t, ended: end };
  };
  const bye = `Thank you for calling Aangan Studio — have a lovely ${istHour(now) < 17 ? "day" : "evening"}!`;

  const asked = s.lastAsked;
  const ext = extract(callerText, { lastAsked: asked === "locationConfirm" ? null : asked, now });
  if (ext.mentionsPriorContact) s.repeatCaller = true;
  if (ext.phoneMentioned) s.altPhone = ext.phoneMentioned;

  // ── wrap-up: confirming the callback number ──
  if (s.phase === "wrapping") {
    const cb = ext.facts.callbackPreference;
    if (cb) s.facts = { ...s.facts, callbackPreference: cb };
    const outside = cb && /(\b([7-9]|1[01])(:\d\d)?pm|night|tonight|\b([1-9])(:\d\d)?am\b|sunday|weekend)/i.test(cb) && !/\b(10|11)(:\d\d)?am/i.test(cb);
    const cbLine = cb ? `I've noted ${cb} as a good time${outside ? " — the studio is open 10am to 7pm, so the designer will call as close to that as they can" : " — I'll pass that on to the designer"}.` : "";
    if (ext.phoneMentioned) return say(`Noted — we'll call you on ${ext.phoneMentioned}. ${cbLine} ${bye}`, true);
    if (ext.no && !cb) {
      s.lastAsked = "phoneConfirm";
      return say("No problem — which number should we call you on?");
    }
    return say(`${cb ? cbLine : "Perfect."} ${bye}`, true);
  }

  // "Is that within Pune city or PCMC?" — the caller's answer settles criterion #2.
  if (asked === "locationConfirm" && s.facts.location) {
    const saysPune = /^(pune|pcmc)$/i.test(ext.facts.location ?? "");
    if (saysPune) delete ext.facts.location;
    if ((ext.yes || saysPune) && !ext.no) ext.facts.locationStatus = "in_area";
    else if (ext.no) ext.facts.locationStatus = "outside";
  }

  const before = s.facts;
  const merged = mergeFacts(s.facts, ext.facts, now.toISOString());
  s.facts = merged.facts;
  s.corrections.push(...merged.corrections);
  for (const u of ext.unknown) if (!s.unknown.includes(u)) s.unknown.push(u);
  for (const d of ext.declined) if (!s.declined.includes(d)) s.declined.push(d);
  if (asked && !s.asked.includes(asked)) s.asked.push(asked);
  // "Yes, design and execution" settles criterion #1 — drop the earlier advice-only reading.
  if (asked === "fullService" && ext.yes && !ext.no) s.facts = { ...s.facts, scope: s.facts.spaces.length && s.facts.scope === "partial" ? "partial" : s.facts.scope === "advisory" ? "full" : s.facts.scope, notOffered: null };

  const f = s.facts;
  const svc = rules.services.rules;
  const qr = rules.qualified.rules;
  const lead: string[] = [];

  // ── routing: existing client ──
  if (f.intent === "existing_client") {
    s.endReason = "escalated";
    return say(
      `I'm really sorry about that${firstName(f)}. I'm flagging this to our studio head right now, and someone senior will call you back within 15 minutes. ${f.callerName ? "" : "Could you tell me your name so they know who to ask for? "}Thank you for your patience.`,
      Boolean(f.callerName),
    );
  }

  // ── criteria that fail → close gracefully (count first: two or more get the rubric's own line) ──
  const typeRule = svc?.projectTypes.find((t) => t.id === f.projectType);
  const loc = (f.location ?? "").toLowerCase();
  const fails: string[] = [];
  if (f.locationStatus === "outside" || svc?.serviceArea.excluded.some((x) => loc.includes(x))) fails.push("area");
  if (typeRule?.inScope === "no") fails.push("type");
  if (f.exploring) fails.push("exploring");
  if (f.decisionMaker === "no") fails.push("decision");
  const floor = budgetFloor(f, rules);
  if (f.budgetMaxInr && floor && f.budgetMaxInr < floor.floorInr) fails.push("budget");
  if (f.timelineDeadline && svc && f.timelineFlexible === false) {
    const w = (new Date(f.timelineDeadline).getTime() - now.getTime()) / (7 * 864e5);
    if (w < svc.leadTimes.minLeadWeeks) fails.push("timeline");
  }
  const siteBand = qr?.criteria.find((c) => c.siteAvailableWithinWeeks)?.siteAvailableWithinWeeks ?? [8, 10];
  if (f.siteAvailableDate && (new Date(f.siteAvailableDate).getTime() - now.getTime()) / (7 * 864e5) > siteBand[1]) fails.push("site");
  if ((f.scope === "advisory" || f.notOffered === "diy_execution") && s.asked.includes("fullService") && !ext.yes) fails.push("advice");

  if (fails.length >= 2 && qr) {
    s.endReason = "not_a_fit";
    return say(`Thank you for explaining${firstName(f)}. ${qr.twoOrMoreFailLine}`, true);
  }
  if (fails.length === 1) {
    s.endReason = "not_a_fit";
    const why = fails[0];
    const line =
      why === "area"
        ? `Thank you for thinking of us. We serve Pune city and PCMC, and we don't have the vendor network to take on projects in ${f.location?.split(",")[0]} — I'm sorry we can't help this time.`
        : why === "type"
          ? `Thank you for reaching out. ${typeRule?.label} interiors are outside what we take on — we focus on homes and small commercial spaces like offices and clinics. A specialist studio would serve you better.`
          : why === "exploring"
            ? "That's completely fine — no pressure at all. Whenever you're ready to go ahead with a project, please call us back. Thank you!"
            : why === "decision"
              ? "That's completely fine. Once they're ready to go ahead, please ask them to give us a call, or call us back on their behalf — we'd love to help."
              : why === "budget"
                ? `I want to be straightforward with you${firstName(f)} — for ${f.scope === "full" ? "a full home" : f.spaces.length ? `the ${f.spaces.join(" and ").toLowerCase()}` : "this scope"} with full execution, that budget would be well below what a project like this costs with us. I'd rather tell you now than have you find out at the consultation. If your plans change, please do call us back.`
                : why === "timeline"
                  ? `I want to be honest with you — we can't begin a project that needs to be ready in under ${svc?.leadTimes.minLeadWeeks} weeks, so we couldn't do it justice by then. If your plans change, please do call us back.`
                  : why === "site"
                    ? `Thanks — since the site won't be ready for a while, it's a little early for us. We'd need it available within a couple of months of the consultation. Please call us closer to possession and we'll pick it up straight away.`
                    : "Of course. Our minimum is a room redesign with execution, so we're not the right fit for advice-only visits — but whenever you're ready for a full project, please call us back. Thank you!";
    return say(line, true);
  }

  // ── unclear on #1: advice / decor / furniture / Vastu only / own execution → one direct question ──
  if ((f.scope === "advisory" || f.notOffered === "diy_execution") && !s.asked.includes("fullService")) {
    s.lastAsked = "fullService";
    return say(question("fullService", s, rules, s.turns.length));
  }

  // ── unclear on #3: deadline tighter than design + execution → say so honestly, ask once ──
  if (f.timelineDeadline && svc && f.timelineFlexible == null && !s.asked.includes("laterStart")) {
    const w = (new Date(f.timelineDeadline).getTime() - now.getTime()) / (7 * 864e5);
    const realistic = svc.leadTimes.designPhaseWeeks[0] + svc.leadTimes.executionWeeks[0];
    if (w < realistic) {
      s.lastAsked = "laterStart";
      const honest =
        w < svc.leadTimes.minLeadWeeks
          ? `I want to be honest with you — we can't begin a project that needs to be ready in under ${svc.leadTimes.minLeadWeeks} weeks.`
          : `I want to be honest — design takes ${svc.leadTimes.designPhaseWeeks.join("–")} weeks and execution at least ${svc.leadTimes.executionWeeks[0]} more, so that date would be very tight.`;
      return say(`${honest} ${question("laterStart", s, rules, 0)}`);
    }
  }

  // ── unclear on #2: a place we can't pin down → one direct question ──
  if (f.location && f.locationStatus === "unrecognised" && !s.asked.includes("locationConfirm")) {
    s.lastAsked = "locationConfirm";
    return say(question("locationConfirm", s, rules, 0));
  }

  if (ext.asksHuman) {
    s.humanAsks++;
    const open = isWithinHours(now, svc?.hours);
    if (s.humanAsks >= 2) {
      s.endReason = "completed";
      return say(`Of course. I'll have someone from the studio call you back${open ? " shortly" : " when we open at 10am"}. ${bye}`, true);
    }
    lead.push(`Of course — I'll make sure someone from the studio calls you${open ? "" : " when we open at 10am"}. Let me take a few details first so they don't have to ask you again.`);
  }

  // ── off-topic / prank questions: one light line, then back to the enquiry (end after repeated detours) ──
  if (ext.abusive || ext.offTopic) {
    s.offTopicCount++;
    if (asked) s.asked = s.asked.filter((x) => x !== asked); // their answer is still owed — ask again
    const hasProject = Boolean(f.projectType || f.location || f.spaces.length || f.scope);
    if (ext.abusive || (s.offTopicCount > 2 && !hasProject)) {
      s.endReason = "caller_left";
      return say(`I'll end the call here — if you'd like help with an interior design project, please call us any time. Goodbye!`, true);
    }
    const quip = pick(
      ["Ha, I'm afraid I can't help with that one — I only handle Aangan's interior design enquiries!", "That's a bit outside my area, I'm afraid — I'm just Aangan Studio's virtual assistant for interior design.", "I wish I knew! I only look after interior design enquiries for Aangan Studio."],
      s.offTopicCount,
    );
    const back = plan(f).find((slot) => !have(s, slot));
    if (back) {
      s.lastAsked = back;
      return say(`${quip} ${hasProject ? question(back, s, rules, s.turns.length) : "Is there a home or office you're planning to do up?"}`);
    }
    return say(`${quip} ${wrapUp(s, rules, now)}`, s.phase === "ended");
  }

  // ── inform ──
  const heardNothing = !Object.keys(ext.facts).length && !ext.unknown.length && !ext.declined.length && !ext.asksPrice && !ext.questions.length && !ext.yes && !ext.no;
  if (heardNothing && !asked) lead.push("Sorry, I didn't quite catch that.");
  else if (heardNothing && asked && !s.retries.includes(asked)) {
    // Couldn't make out the answer: ask the same thing once more, then move on (never loop).
    s.retries = [...s.retries, asked];
    s.asked = s.asked.filter((x) => x !== asked);
    lead.push("Sorry, I didn't catch that.");
  }
  lead.push(...acknowledge(before, f, ext, merged.corrections, s));
  lead.push(...answerBasics(ext.questions, rules));
  if (ext.asksPrice) {
    s.priceAsked++;
    // pricing.md decides: the approved line, never a number (unless the file is changed to allow it).
    lead.push(s.priceAsked > 1 && !rules.pricing.rules?.agentMayQuote ? "I understand — I'd rather not give you a number that turns out to be wrong. The designer will go through it properly with you." : callerPriceResponse(indicativePrice(f, rules), rules));
  }

  // ── next question ──
  const next = plan(f).find((slot) => !have(s, slot));
  if (next) {
    s.lastAsked = next;
    return say(`${lead.join(" ")} ${question(next, s, rules, s.turns.length)}`);
  }
  // No filler ("Okay.") in front of the wrap-up — it opens with its own thank-you.
  const wrapLead = lead.filter((x) => !/^(Got it|Okay|Right)\.$/.test(x));
  return say(`${wrapLead.join(" ")} ${wrapUp(s, rules, now)}`, s.phase === "ended");
}

function wrapUp(s: DialogueState, rules: Ruleset, now: Date): string {
  const f = s.facts;
  const afterHours = !isWithinHours(now, rules.services.rules?.hours);
  const q = qualify(f, rules, { now, callStatus: "completed", afterHours, pricing: indicativePrice(f, rules), repeatCaller: s.repeatCaller, unknownFields: s.unknown, declinedFields: s.declined });
  s.endReason = "completed";
  if (q.status === "NOT_QUALIFIED") {
    s.phase = "ended";
    return `Thank you${firstName(f)}. ${q.failedCriteria >= 2 && rules.qualified.rules ? rules.qualified.rules.twoOrMoreFailLine : "I'm afraid this one isn't a fit for us right now — but please do call us back if anything changes."}`;
  }
  const recap = [
    f.propertyType ? `a ${f.propertyType}` : f.projectType && f.projectType !== "residential" ? `a ${f.projectType}` : "your home",
    f.location ? `in ${f.location.split(",")[0]}` : null,
    f.scope === "full" ? "the full scope" : f.spaces.length ? f.spaces.join(", ").toLowerCase() : null,
    f.timeline ? f.timeline[0].toLowerCase() + f.timeline.slice(1) : null,
  ]
    .filter(Boolean)
    .join(", ");
  const when = afterHours ? "The studio opens at 10am, and a designer will call you then" : "A designer will call you back shortly";
  s.phase = "wrapping";
  s.lastAsked = "phoneConfirm";
  if (q.status === "QUALIFIED") {
    return `Thank you${firstName(f)}. So that's ${recap}. I'm passing all of this to our designers right now, so you won't have to repeat any of it. ${when} to book your consultation. Is this number the best one to reach you on, and is there a time that suits you?`;
  }
  return `Thank you${firstName(f)} — I've noted everything: ${recap}. Someone from the studio will look at the details and ${afterHours ? "call you after 10am" : "get back to you shortly"} with the next step. Is this number the best one to reach you on, and is there a time that suits you?`;
}
