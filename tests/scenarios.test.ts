import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import type { Ruleset } from "../src/lib/rules/schema";

// End-to-end scenarios: a scripted caller talks to the dialogue engine; the finished call becomes a
// signed VaaniYantra webhook; the webhook handler stores, qualifies and hands off.

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "aangan-test-"));
process.env.DEMO_MODE = "true";
process.env.VAANI_PROVIDER = "vaaniyantra"; // the original adapter's tests; VaaniVoice has its own block below
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.VAANI_API_KEY;

const IN_HOURS = new Date("2026-10-12T05:30:00Z"); // Mon 11:00 IST
const AFTER_HOURS = new Date("2026-10-12T17:00:00Z"); // Mon 22:30 IST

let rules: Ruleset;
let lib: {
  dialogue: typeof import("../src/lib/agent/dialogue");
  webhook: typeof import("../src/lib/vaani/webhook");
  sig: typeof import("../src/lib/vaani/signature");
  facts: typeof import("../src/lib/facts");
  process: typeof import("../src/lib/process");
  store: typeof import("../src/lib/store");
};

beforeAll(async () => {
  lib = {
    dialogue: await import("../src/lib/agent/dialogue"),
    webhook: await import("../src/lib/vaani/webhook"),
    sig: await import("../src/lib/vaani/signature"),
    facts: await import("../src/lib/facts"),
    process: await import("../src/lib/process"),
    store: await import("../src/lib/store"),
  };
  rules = await (await import("../src/lib/rules/load")).loadRuleset();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.VAANI_API_KEY;
  delete process.env.VAANI_API_BASE;
  process.env.DEMO_MODE = "true";
  const s = lib.store.getStore();
  await s.saveSettings({ ...(await s.getSettings()), simulateHandoffFailure: false, simulateVaaniApiFailure: false });
});

function talk(lines: string[], start = IN_HOURS) {
  let t = start.getTime();
  let { state } = lib.dialogue.startDialogue(new Date(t), rules);
  const replies: string[] = [];
  for (const line of lines) {
    if (state.phase === "ended") break;
    t += 20_000;
    const r = lib.dialogue.step(state, line, rules, new Date(t));
    state = r.state;
    replies.push(r.reply);
  }
  return { state, replies, endedAt: new Date(t + 5000) };
}

let n = 0;
async function deliver(conv: ReturnType<typeof talk>, opts: { phone?: string; withTranscript?: boolean; endedEarly?: boolean; callId?: string } = {}) {
  const id = opts.callId ?? `test_${++n}_${Date.now()}`;
  const s = conv.state;
  const data: Record<string, unknown> = {
    id,
    direction: "INBOUND",
    status: "COMPLETED",
    fromNumber: opts.phone ?? `+91900000${String(n).padStart(4, "0")}`,
    durationSec: Math.round((conv.endedAt.getTime() - new Date(s.startedAt).getTime()) / 1000),
    collectedData: lib.facts.factsToCollectedData(s.facts, s.unknown, s.declined, { call_ended_early: opts.endedEarly ?? false, repeat_caller: s.repeatCaller }),
    createdAt: new Date(new Date(s.startedAt).getTime() - 3000).toISOString(),
    endedAt: conv.endedAt.toISOString(),
  };
  if (opts.withTranscript !== false) {
    data.transcript = s.turns;
    data.startedAt = s.startedAt;
  }
  const raw = JSON.stringify({ event: "call.completed", timestamp: new Date().toISOString(), data });
  const out = await lib.webhook.handleVaaniWebhook(raw, lib.sig.sign(raw, lib.webhook.webhookSecret().secret!), "http://localhost:0");
  if (out.status === 200 && "followUp" in out && out.followUp) await out.followUp();
  const enquiryId = out.status === 200 ? out.body.enquiryId : undefined;
  return { out, raw, id, enquiry: enquiryId ? await lib.store.getStore().getEnquiry(enquiryId) : null };
}

const agentSaidANumber = (replies: string[]) => replies.some((r) => /₹|\blakh\b|\bcrore\b|per (sq|square)|\d{2,}[, ]?\d{3}\s*(rupees|rs)/i.test(r));

const QUALIFIED_CALL = [
  "Hi, I'm Priya Kulkarni. We have a 3BHK in Kothrud and want to do the whole flat.",
  "About 1,400 square feet carpet.",
  "Yes, we own it — my husband and I, he's happy to go ahead.",
  "We'd like it done by March next year, we're not in a rush.",
  "Yes, this number is fine.",
];

describe("1 · clearly qualified residential project", () => {
  it("qualifies, prices internally, hands off, and never quotes a number", async () => {
    const conv = talk(QUALIFIED_CALL);
    expect(conv.state.phase).toBe("ended");
    expect(agentSaidANumber(conv.replies)).toBe(false);
    const { enquiry: e } = await deliver(conv);
    expect(e?.qualificationStatus).toBe("QUALIFIED");
    expect(e?.callerName).toBe("Priya Kulkarni");
    expect(e?.location).toContain("Kothrud");
    expect(e?.areaSqFt).toBe(1400);
    expect(e?.pricing.status).toBe("estimated");
    expect(e?.indicativePriceMin).toBe(1400 * 1800); // pricing.md standard tier
    expect(e?.pricing.internalOnly).toBe(true);
    expect(e?.handoffStatus).toBe("SENT");
    expect(e?.handoff.note?.text).toContain("NEW QUALIFIED ENQUIRY");
    expect(e?.handoff.note?.text).toContain("Kothrud");
    expect(e?.aiCost).toBeGreaterThan(0);
    // never asks budget (qualified.md › 4)
    expect(conv.replies.some((r) => /budget/i.test(r))).toBe(false);
  });
});

describe("2 · clearly unqualified enquiry", () => {
  it("declines out-of-area politely and doesn't forward", async () => {
    const conv = talk(["Hello, I'm Suresh Patil from Nashik. I want to redo my home office and study."]);
    expect(conv.state.phase).toBe("ended");
    expect(conv.replies.at(-1)).toMatch(/Pune city and PCMC/);
    const { enquiry: e } = await deliver(conv);
    expect(e?.qualificationStatus).toBe("NOT_QUALIFIED");
    expect(e?.handoffRequired).toBe(false);
  });
  it("declines a restaurant", async () => {
    const conv = talk(["I'm opening a restaurant in Koregaon Park, can you design it?"]);
    expect(conv.state.phase).toBe("ended");
    const { enquiry: e } = await deliver(conv);
    expect(e?.qualificationStatus).toBe("NOT_QUALIFIED");
  });
  it("uses the rubric's line when two criteria fail", async () => {
    const conv = talk(["Hi, I'm looking at a flat in Talegaon, but honestly we're just exploring for now."]);
    expect(conv.replies.at(-1)).toContain(rules.qualified.rules!.twoOrMoreFailLine);
  });
});

describe("3 · caller outside business hours", () => {
  it("answers, qualifies, hands off, and sets expectations for 10am", async () => {
    const conv = talk(QUALIFIED_CALL, AFTER_HOURS);
    expect(conv.replies[0] ?? "").toBeTruthy();
    expect(conv.state.turns[0].text).toMatch(/closed right now/);
    expect(conv.replies.join(" ")).toMatch(/10am/);
    const { enquiry: e } = await deliver(conv);
    expect(e?.afterHours).toBe(true);
    expect(e?.flags).toContain("After hours");
    expect(e?.qualificationStatus).toBe("QUALIFIED");
    expect(e?.handoffStatus).toBe("SENT");
  });
});

describe("4 · caller doesn't know the square footage", () => {
  it("records unknown, never re-asks, doesn't guess a price", async () => {
    const conv = talk([
      "Hi, I'm Meena. I want to redesign my 2BHK in Baner, the whole home.",
      "Honestly I don't know the size.",
      "Yes it's ours.",
      "By April next year.",
      "Yes.",
    ]);
    const sizeQs = conv.replies.filter((r) => /square feet|carpet area/i.test(r));
    expect(sizeQs.length).toBe(1);
    const { enquiry: e } = await deliver(conv);
    expect(e?.unknownFields).toContain("areaSqFt");
    expect(e?.areaSqFt).toBeNull();
    expect(e?.pricing.status).toBe("insufficient_info");
    expect(e?.qualificationStatus).toBe("QUALIFIED");
    expect(e?.handoff.note?.text).toMatch(/Area: Caller didn't know/);
  });
});

describe("5 · caller asks for pricing immediately", () => {
  it("gives pricing.md's approved response, never a number, and carries on", async () => {
    const conv = talk(["How much do you charge per square foot for a 2BHK?", "It's in Wakad, about 950 square feet, the full home.", "Rahul.", "Yes I own it.", "January.", "Yes."]);
    expect(conv.replies[0]).toContain(rules.pricing.rules!.approvedResponse);
    expect(agentSaidANumber(conv.replies)).toBe(false);
    const { enquiry: e } = await deliver(conv);
    expect(e?.qualificationStatus).toBe("QUALIFIED"); // asking for pricing doesn't disqualify
    expect(e?.pricing.status).toBe("estimated");
  });
});

describe("6 · caller changes an answer during the call", () => {
  it("uses the corrected value, acknowledges it, and records the correction", async () => {
    const conv = talk([
      "Hi I'm Arjun, we have a 3BHK in Aundh, full home.",
      "About 1,400 square feet.",
      "Actually sorry, it's 1,200 square feet, not 1,400.",
      "Yes we own it.",
      "Done by May next year.",
      "Yes.",
    ]);
    expect(conv.replies.join(" ")).toMatch(/1,200 square feet, not 1,400/);
    const { enquiry: e } = await deliver(conv);
    expect(e?.areaSqFt).toBe(1200);
    expect(e?.corrections.some((c) => c.field === "areaSqFt" && c.from === "1400" && c.to === "1200")).toBe(true);
    expect(e?.handoff.note?.text).toMatch(/corrected areaSqFt/);
  });
});

describe("7 · missing required information", () => {
  it("caller hangs up early → stored as NEEDS REVIEW with what's missing, call-back listed", async () => {
    const conv = talk(["Hi, I wanted to ask about interiors for my"]);
    const { enquiry: e } = await deliver(conv, { endedEarly: true });
    expect(e?.callStatus).toBe("hung_up_early");
    expect(e?.qualificationStatus).toBe("NEEDS_REVIEW");
    expect(e?.missingInfo).toEqual(expect.arrayContaining(["location", "timeline"]));
  });
  it("caller refuses to answer → declined, never asked again, not invented", async () => {
    const conv = talk(["Hi, I'm Kavya, 2BHK in Hinjewadi, full interiors.", "I'd rather not say.", "We own it.", "Flexible, no deadline.", "Yes."]);
    const { enquiry: e } = await deliver(conv);
    expect(e?.declinedFields).toContain("areaSqFt");
    expect(e?.areaSqFt).toBeNull();
  });
  it("a dropped call followed by a call-back merges into one enquiry", async () => {
    const phone = "+919811112222";
    const first = await deliver(talk(["Hi, I'm Ritu Kapoor, 3BHK in Pimple Saudagar —"]), { phone, endedEarly: true });
    const second = await deliver(talk(["Hi, I got cut off. Kitchen, wardrobes, living room. About 1,050 square feet.", "Yes we own it.", "By March next year.", "Yes."]), { phone });
    expect(second.enquiry?.previousEnquiryId).toBe(first.enquiry?.id);
    expect(second.enquiry?.callerName).toBe("Ritu Kapoor"); // carried over from the dropped call
    expect((await lib.store.getStore().getEnquiry(first.enquiry!.id))?.supersededBy).toBe(second.enquiry?.id);
  });
});

describe("8 · Telegram handoff failure", () => {
  it("keeps the enquiry, marks HANDOFF PENDING with the error, and a retry sends it", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "-100123";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, description: "Bad Gateway" }), { status: 502 })));
    const { enquiry: e } = await deliver(talk(QUALIFIED_CALL));
    expect(e?.qualificationStatus).toBe("QUALIFIED");
    expect(e?.handoffStatus).toBe("PENDING");
    expect(e?.handoff.lastError).toMatch(/Telegram 502/);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const again = await lib.process.dispatchHandoff(e!.id);
    expect(again?.handoffStatus).toBe("PENDING");
    expect(again?.handoff.lastError).toMatch(/Network error/);

    const sent = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 }));
    vi.stubGlobal("fetch", sent);
    const r = await lib.process.retryPendingHandoffs();
    expect(r.sent).toBeGreaterThanOrEqual(1);
    const final = await lib.store.getStore().getEnquiry(e!.id);
    expect(final?.handoffStatus).toBe("SENT");
    expect(final?.handoff.attempts.length).toBe(3);
    const body = JSON.parse((sent.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.parse_mode).toBe("HTML");
    expect(body.text).toContain("NEW QUALIFIED ENQUIRY");
    // never re-sent once SENT
    await lib.process.dispatchHandoff(e!.id);
    expect((await lib.store.getStore().getEnquiry(e!.id))?.handoff.attempts.length).toBe(3);
  });
});

describe("9 · Vaani API failure", () => {
  it("stores and qualifies from the webhook alone when the transcript fetch fails", async () => {
    process.env.VAANI_API_KEY = "ck_live_test";
    process.env.VAANI_API_BASE = "https://vaani.invalid";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 503 })));
    const { enquiry: e } = await deliver(talk(QUALIFIED_CALL), { withTranscript: false });
    expect(e?.transcriptStatus).toBe("fetch_failed");
    expect(e?.processingErrors.join(" ")).toMatch(/Vaani API 503/);
    expect(e?.qualificationStatus).toBe("QUALIFIED"); // from collectedData
    expect(e?.handoffStatus).toBe("SENT"); // demo inbox — handoff isn't blocked by the Vaani failure
  });
  it("rejects a webhook with a bad signature", async () => {
    const out = await lib.webhook.handleVaaniWebhook(JSON.stringify({ event: "call.completed", data: { id: "x" } }), "sha256=deadbeef", "http://x");
    expect(out.status).toBe(401);
  });
  it("fails closed when no secret is configured outside demo mode", async () => {
    process.env.DEMO_MODE = "false";
    const out = await lib.webhook.handleVaaniWebhook("{}", null, "http://x");
    expect(out.status).toBe(503);
  });
  it("records a call.failed (missed) call for call-back", async () => {
    const raw = JSON.stringify({ event: "call.failed", data: { id: `missed_${Date.now()}`, direction: "INBOUND", status: "NO_ANSWER", fromNumber: "+919999000111", createdAt: new Date().toISOString() } });
    const out = await lib.webhook.handleVaaniWebhook(raw, lib.sig.sign(raw, lib.webhook.webhookSecret().secret!), "http://x");
    expect(out.status).toBe(200);
    const e = await lib.store.getStore().getEnquiry((out.body as { enquiryId: string }).enquiryId);
    expect(e?.callStatus).toBe("missed");
    expect(e?.recommendedNextAction).toMatch(/Call the number back/);
  });
});

describe("10 · duplicate webhook event", () => {
  it("processes once; the retry is acknowledged as a duplicate", async () => {
    const first = await deliver(talk(QUALIFIED_CALL), { callId: "dup_call_1" });
    const before = (await lib.store.getStore().listEnquiries()).length;
    const again = await lib.webhook.handleVaaniWebhook(first.raw, lib.sig.sign(first.raw, lib.webhook.webhookSecret().secret!), "http://x");
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, enquiryId: first.enquiry?.id });
    expect((await lib.store.getStore().listEnquiries()).length).toBe(before);
    // concurrent duplicate deliveries also collapse to one
    const conv = talk(QUALIFIED_CALL);
    const raw = JSON.stringify({ event: "call.completed", data: { id: "dup_call_2", direction: "INBOUND", fromNumber: "+911", durationSec: 60, createdAt: new Date().toISOString(), collectedData: lib.facts.factsToCollectedData(conv.state.facts, [], []) } });
    const sigH = lib.sig.sign(raw, lib.webhook.webhookSecret().secret!);
    const results = await Promise.all([1, 2, 3].map(() => lib.webhook.handleVaaniWebhook(raw, sigH, "http://x")));
    expect(results.filter((r) => r.status === 200 && !("duplicate" in r.body && r.body.duplicate)).length).toBe(1);
  });
});

describe("rubric edge cases", () => {
  it("volunteered budget clearly below scope → addressed on the call without numbers, not forwarded", async () => {
    const conv = talk(["Hi, 1BHK in Kharadi. I want to do the kitchen and one bedroom. My budget is 1 to 1.5 lakh maximum."]);
    expect(conv.replies.at(-1)).toMatch(/well below/);
    expect(conv.replies.at(-1)).not.toMatch(/₹|lakh|\d{2,}/);
    const { enquiry: e } = await deliver(conv);
    expect(e?.qualificationStatus).toBe("NOT_QUALIFIED");
  });
  it("deadline under the 6-week minimum → honest, offers a later date; accepting it qualifies", async () => {
    const conv = talk(["Hi I'm Divya, 2BHK in Wakad, living room and kitchen. We need it done in 3 weeks, guests are arriving.", "Yes, a later date is fine actually.", "Yes we own it.", "About 875 square feet.", "Yes."]);
    expect(conv.replies[0]).toMatch(/under 6 weeks/);
    const { enquiry: e } = await deliver(conv);
    expect(e?.timelineFlexible).toBe(true);
    expect(e?.qualificationStatus).toBe("QUALIFIED");
  });
  it("research for family without authority, still unclear → qualified with the uncertainty noted", async () => {
    const conv = talk(["Hi, I'm Rohan, enquiring for my parents' 3BHK in Hadapsar, new possession, full home.", "They'll decide, but they will come to the consultation.", "About 1,200 square feet.", "By June next year.", "Yes."]);
    const { enquiry: e } = await deliver(conv);
    expect(e?.decisionMaker).toBe("family_attending");
    expect(e?.qualificationStatus).toBe("QUALIFIED");
    expect(e?.handoff.note?.text).toMatch(/Uncertain:.*authority not confirmed/i);
  });
  it("existing client complaint → escalation, not a new enquiry", async () => {
    const conv = talk(["My name is Sheetal Deshpande. My project has been going for three months and my designer hasn't replied in five days."]);
    expect(conv.state.phase).toBe("ended");
    const { enquiry: e } = await deliver(conv);
    expect(e?.handoff.kind).toBe("escalation");
    expect(e?.handoffStatus).toBe("SENT");
  });
  it("unrecognised locality → one direct question; confirmation settles it", async () => {
    const conv = talk(["Hi, I'm Neel, a 2BHK in Bhugaon, whole home.", "Yes, it's in Pune.", "About 900 square feet.", "Yes, ours.", "By May next year.", "Yes."]);
    expect(conv.replies[0]).toMatch(/Pune city or PCMC/);
    const { enquiry: e } = await deliver(conv);
    expect(e?.qualificationStatus).toBe("QUALIFIED");
  });
});

describe("replay of September's real phone transcripts", () => {
  it("processes all 20 calls with sensible outcomes", async () => {
    const { seedReplays } = await import("../src/lib/replay");
    expect(await seedReplays()).toBe(21); // T17 is two calls
    const all = (await lib.store.getStore().listEnquiries()).filter((e) => e.source === "replay");
    const by = (id: string) => all.find((e) => e.replayOf === id)!;
    expect(by("T01").qualificationStatus).toBe("QUALIFIED");
    expect(by("T03").qualificationStatus).toBe("NOT_QUALIFIED"); // Nashik
    expect(by("T04").qualificationStatus).toBe("NOT_QUALIFIED"); // advice only
    expect(by("T09").handoff.kind).toBe("escalation");
    expect(by("T10").qualificationStatus).toBe("NOT_QUALIFIED"); // budget clearly below
    expect(by("T19").qualificationStatus).toBe("NOT_QUALIFIED"); // restaurant
    expect(by("T08").callStatus).toBe("missed");
    expect(by("T17").previousEnquiryId).toBe(by("T17a").id);
    // replays never go to Telegram
    expect(all.every((e) => e.handoff.status !== "SENT" || e.handoff.channel === "demo-inbox")).toBe(true);
  });
});

describe("HubSpot CRM sync", () => {
  it("creates contact + note + deal for a qualified caller; failure stays PENDING and retries without duplicates", async () => {
    process.env.HUBSPOT_TOKEN = "pat-test";
    const calls: string[] = [];
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const u = new URL(url);
      calls.push(`${init.method} ${u.pathname}`);
      if (fail) return new Response(JSON.stringify({ message: "Service Unavailable" }), { status: 503 });
      if (u.pathname.endsWith("/contacts/search")) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      if (u.pathname === "/crm/v3/objects/contacts") return new Response(JSON.stringify({ id: "c1" }), { status: 201 });
      if (u.pathname === "/crm/v3/objects/notes") return new Response(JSON.stringify({ id: "n1" }), { status: 201 });
      if (u.pathname === "/crm/v3/objects/deals") return new Response(JSON.stringify({ id: "d1" }), { status: 201 });
      return new Response("{}", { status: 404 });
    }));
    const { enquiry } = await deliver(talk(QUALIFIED_CALL), { phone: "+919812345678" });
    expect(enquiry?.handoffStatus).toBe("SENT"); // CRM failure never blocks the designer
    expect(enquiry?.crm?.status).toBe("PENDING");

    fail = false;
    const { syncCrm } = await import("../src/lib/crm");
    const synced = await syncCrm(enquiry!.id);
    expect(synced?.crm).toMatchObject({ status: "SYNCED", contactId: "c1", dealId: "d1" });
    const deals = calls.filter((c) => c === "POST /crm/v3/objects/deals").length;
    await syncCrm(enquiry!.id); // nothing changed → no new writes
    expect(calls.filter((c) => c === "POST /crm/v3/objects/deals").length).toBe(deals);
    delete process.env.HUBSPOT_TOKEN;
  });
});

describe("Zoho CRM sync", () => {
  it("upserts a Lead, adds a note, converts a qualified lead into Contact + Deal once; failures retry without duplicates", async () => {
    Object.assign(process.env, { CRM_PROVIDER: "zoho", ZOHO_CLIENT_ID: "cid", ZOHO_CLIENT_SECRET: "sec", ZOHO_REFRESH_TOKEN: "rt", ZOHO_DC: "in" });
    const calls: string[] = [];
    let convertFails = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const u = new URL(url);
      calls.push(`${init.method} ${u.host}${u.pathname}`);
      const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (u.host === "accounts.zoho.in") return ok({ access_token: "at", expires_in: 3600 });
      expect((init.headers as Record<string, string>).Authorization).toBe("Zoho-oauthtoken at");
      if (u.pathname === "/crm/v8/Leads/upsert") {
        const body = JSON.parse(init.body as string);
        expect(body.duplicate_check_fields).toEqual(["Phone"]);
        expect(body.data[0].Last_Name).toBe("Kulkarni");
        return ok({ data: [{ code: "SUCCESS", status: "success", details: { id: "L1" } }] });
      }
      if (u.pathname.endsWith("/Notes")) return ok({ data: [{ code: "SUCCESS", status: "success", details: { id: `N${calls.length}` } }] }, 201);
      if (u.pathname === "/crm/v8/Leads/L1/actions/convert") {
        if (convertFails) return ok({ message: "internal error" }, 500);
        return ok({ data: [{ code: "SUCCESS", status: "success", details: { Contacts: { id: "C1" }, Deals: { id: "D1" } } }] });
      }
      return ok({}, 404);
    }));
    const { enquiry } = await deliver(talk(QUALIFIED_CALL), { phone: "+919800011122" });
    expect(enquiry?.handoffStatus).toBe("SENT");
    expect(enquiry?.crm).toMatchObject({ provider: "zoho", status: "PENDING", contactId: "L1", recordType: "Lead" }); // lead kept despite the failure

    convertFails = false;
    const { syncCrm } = await import("../src/lib/crm");
    const synced = await syncCrm(enquiry!.id);
    expect(synced?.crm).toMatchObject({ status: "SYNCED", contactId: "C1", dealId: "D1", recordType: "Contact" });
    const converts = calls.filter((c) => c.endsWith("/actions/convert")).length;
    await syncCrm(enquiry!.id);
    expect(calls.filter((c) => c.endsWith("/actions/convert")).length).toBe(converts); // never converted twice
    for (const k of ["CRM_PROVIDER", "ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"]) delete process.env[k];
  });
});

describe("VaaniVoice adapter", () => {
  const send = async (body: unknown, token = "demo-token-local-only") => {
    const { handleVaaniVoiceWebhook } = await import("../src/lib/vaani/vaanivoice");
    const out = await handleVaaniVoiceWebhook(JSON.stringify(body), token, "http://localhost:0");
    if (out.followUp) await out.followUp();
    return out;
  };

  it("stitches call_started (phone) + post-call payload (entities, transcript) into a qualified enquiry", async () => {
    process.env.VAANI_PROVIDER = "vaanivoice";
    const conv = talk(QUALIFIED_CALL);
    const room = `room_vv_${Date.now()}`;
    const transcript = conv.state.turns.map((t) => `${t.role === "AGENT" ? "AGENT" : "USER"}: ${t.text}`).join("\n\n");
    await send({ event: "call_started", room_name: room, status: "started", phone_number: "+919876500001" });
    await send({ event: "user_picked_up_at", room_name: room, status: "picked_up" });
    await send({ event: "call_ended", room_name: room, call_duration: 142, end_reason: "agent_ended_call" });
    const entities = lib.facts.factsToCollectedData(conv.state.facts, conv.state.unknown, conv.state.declined);
    const post = { event: "call_postprocessing", call_id: `vv_${room}`, timestamp: new Date().toISOString(), data: { room_name: room, call_id: `vv_${room}`, call_duration: 142000, end_reason: "agent_ended_call", summary: "Caller wants a full 3BHK redesign.", entities, dispositions: {}, recording_url: null, transcript } };
    const out = await send(post);
    expect(out.status).toBe(200);
    const e = await lib.store.getStore().getEnquiry((out.body as { enquiryId: string }).enquiryId);
    expect(e?.phone).toBe("+919876500001");
    expect(e?.callDurationSeconds).toBe(142);
    expect(e?.transcript.length).toBeGreaterThan(4);
    expect(e?.qualificationStatus).toBe("QUALIFIED");
    expect(e?.handoffStatus).toBe("SENT");
    // retried post-call webhook → no second enquiry
    expect((await send(post)).body).toMatchObject({ duplicate: true });
  });

  it("rejects a wrong token, and fetches the transcript from call_details when the webhook lacks it", async () => {
    process.env.VAANI_PROVIDER = "vaanivoice";
    expect((await send({ event: "call_started", room_name: "x" }, "wrong")).status).toBe(401);
    process.env.VAANI_API_KEY = "vaani_test";
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      seen.push(`${url} ${(init.headers as Record<string, string>)["X-API-Key"]}`);
      return new Response(JSON.stringify({ transcription: "AGENT: Hello, Aangan Studio.\n\n USER: Hi, I'm Neha, 2BHK in Baner, whole home, about 900 square feet, by May next year.", entity: { caller_name: "Neha", location: "Baner" }, summary: "2BHK Baner", conversation_eval: {}, call_eval_tag: null }), { status: 200 });
    }));
    const room = `room_vv2_${Date.now()}`;
    await send({ event: "call_started", room_name: room, phone_number: "+919876500002" });
    const out = await send({ event: "call_postprocessing", call_id: `vv_${room}`, data: { room_name: room, call_id: `vv_${room}`, call_duration: 60000, transcript: "", entities: {} } });
    expect(seen[0]).toBe(`https://api.vaanivoice.ai/api/call_details/vv_${room} vaani_test`);
    const e = await lib.store.getStore().getEnquiry((out.body as { enquiryId: string }).enquiryId);
    expect(e?.transcriptStatus).toBe("complete");
    expect(e?.callerName).toBe("Neha");
    expect(e?.areaSqFt).toBe(900);
    process.env.VAANI_PROVIDER = "vaaniyantra";
  });
});

describe("VaaniVoice auto-generated entity names", () => {
  it("maps name / locality / rooms_or_whole_home / carpet_area and reads unknown fields as text", async () => {
    const { factsFromCollectedData } = await import("../src/lib/vaani/normalize");
    const { facts } = factsFromCollectedData(
      { name: "Priya Kulkarni", project_type: "Home", locality: "Kothrud", rooms_or_whole_home: "Whole home", carpet_area: "about 1,400 sq ft", project_due_date: "By March next year", is_owner: "Yes, we own it", custom_note: "It's a 3BHK" },
      IN_HOURS,
    );
    expect(facts).toMatchObject({ callerName: "Priya Kulkarni", projectType: "residential", locationStatus: "in_area", scope: "full", areaSqFt: 1400 });
    expect(facts.location).toContain("Kothrud");
    expect(facts.timeline).toMatch(/March/);
    expect(facts.propertyType).toBe("3BHK apartment");
  });
});

describe("real VaaniVoice payload shapes (observed 10 Oct 2026)", () => {
  it("reads nested data, duration in seconds, ISO due date — and flags the 7-week deadline", async () => {
    process.env.VAANI_PROVIDER = "vaanivoice";
    const { handleVaaniVoiceWebhook } = await import("../src/lib/vaani/vaanivoice");
    const send = async (b: unknown) => {
      const o = await handleVaaniVoiceWebhook(JSON.stringify(b), "demo-token-local-only", "http://localhost:0");
      if (o.followUp) await o.followUp();
      return o;
    };
    const room = `outbound-${Date.now()}-abcd1234`;
    const hdr = { to: "+919900000001", from: "+918035315360" };
    await send({ event: "call_started", timestamp: "2026-10-10T11:52:12.357451+00:00", ...hdr, data: { room_name: room, phone_number: "+919900000001", call_type: "Outbound", agent_name: "x" } });
    await send({ event: "user_picked_up_at", timestamp: "2026-10-10T11:52:34.392781+00:00", ...hdr, data: { room_name: room, phone_number: "+919900000001", picked_up_at: "2026-10-10T11:52:34.389017" } });
    await send({ event: "call_ended", timestamp: "2026-10-10T11:55:57.682325+00:00", ...hdr, data: { room_name: room, end_reason: "Call ended", call_duration: 202.791446, technical_issue: false } });
    const out = await send({
      event: "call_postprocessing", call_id: room, timestamp: "2026-10-10T11:56:41Z",
      data: { room_name: room, call_id: room, call_duration: 202.79, end_reason: "Call ended", summary: "s", dispositions: {}, recording_url: null,
        transcript: "[11:52:40] AGENT: Hello, Aangan Studio.\n[11:52:45] USER: Hi, I'm looking to design my house.",
        entities: { name: "Gaurav", project_type: "home", locality: "Hinjewadi", rooms_or_whole_home: "whole home", carpet_area: "1,500", own_or_rented: "owner-occupied", project_due_date: "2026-11-30", callback_number: null, budget: null, decision_maker: "yes", intent: "new_project", exploring: false, call_ended_early: false } },
    });
    const e = await lib.store.getStore().getEnquiry((out.body as { enquiryId: string }).enquiryId);
    expect(e?.phone).toBe("+919900000001");
    expect(e?.callDurationSeconds).toBe(203);
    expect(e?.aiCost).toBeGreaterThan(0);
    expect(e?.answerDelaySec).toBe(22);
    expect(e?.timelineDeadline).toBe("2026-11-30");
    expect(e?.qualificationStatus).toBe("NEEDS_REVIEW"); // ~7 weeks: above the 6-week minimum, under design + execution
    process.env.VAANI_PROVIDER = "vaaniyantra";
  });
});

describe("off-topic and prank questions", () => {
  it("answers lightly, doesn't opine, steers back — and the enquiry still completes", async () => {
    const conv = talk([
      "Why is Donald Trump not coming to my place?",
      "Ok fine. I have a 2BHK in Baner, whole home.",
      "What's the weather like today?",
      "Meena.",
      "About 900 square feet.",
      "Yes, we own it.",
      "By May next year.",
      "Yes.",
    ]);
    expect(conv.replies[0]).toMatch(/can't help with that|outside my area|wish I knew/i);
    expect(conv.replies[0]).toMatch(/home or office/);
    expect(conv.replies[0]).not.toMatch(/trump|president|politic/i);
    expect(conv.replies[2]).toMatch(/can't help with that|outside my area|wish I knew/i);
    expect(conv.replies[2]).toMatch(/square feet|name|speaking with/i); // goes straight back to the question it needed
    const { enquiry } = await deliver(conv);
    expect(enquiry?.qualificationStatus).toBe("QUALIFIED");
  });
  it("ends politely after repeated detours with no project, or on abuse", () => {
    const conv = talk(["Who will win the cricket match?", "Is the moon made of cheese?", "Why is the sky blue?"]);
    expect(conv.state.phase).toBe("ended");
    expect(conv.replies.at(-1)).toMatch(/Goodbye!$/);
  });
});

describe("identity question", () => {
  it("answers 'are you a robot?' honestly", () => {
    const conv = talk(["Are you a robot?"]);
    expect(conv.replies[0]).toMatch(/virtual assistant — an AI/);
  });
});

describe("misheard localities", () => {
  it("maps speech-to-text garbles to the right Pune locality", async () => {
    const { findLocalities } = await import("../src/lib/localities");
    expect(findLocalities("The location is Hinduwari")[0]?.name).toBe("Hinjewadi");
    expect(findLocalities("At Sanhinjawari")[0]?.name).toBe("Hinjewadi");
    expect(findLocalities("I live in Kotrud")[0]?.name).toBe("Kothrud");
    expect(findLocalities("we're in Pimple Saudagr")[0]?.name).toBe("Pimple Saudagar");
    expect(findLocalities("I'm looking to design my house").length).toBe(0); // no false positives on ordinary words
    expect(findLocalities("whole whole home please, within two months").length).toBe(0);
  });
});
