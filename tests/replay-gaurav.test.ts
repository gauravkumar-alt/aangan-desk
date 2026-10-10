import { test, expect } from "vitest";

// The real test call from 10 Oct (speech-to-text included its errors) — replayed after the fixes.
test("Gaurav's call: unclear opener, name ack, callback time honoured", async () => {
  const { startDialogue, step } = await import("../src/lib/agent/dialogue");
  const rules = await (await import("../src/lib/rules/load")).loadRuleset();
  let t = new Date("2026-10-10T11:38:00Z").getTime();
  let { state, reply } = startDialogue(new Date(t), rules);
  const lines = ["highest score of", "just for a home", "why this is Gaurav", "I am looking at Hinjewadi", "whole home please", "SS approximately 1500 square feet", "this is my own home", "as soon as possible please", "you can reach me tomorrow at 7:00 p.m. please"];
  const out = [reply];
  for (const l of lines) {
    t += 15000;
    const r = step(state, l, rules, new Date(t));
    state = r.state;
    out.push(`> ${l}`, r.reply);
  }
  console.log(out.join("\n"));
  expect(out[2]).toMatch(/didn't quite catch/);
  expect(out.join(" ")).toMatch(/Thanks, Gaurav|Nice to meet you, Gaurav/);
  expect(out.at(-1)).toMatch(/tomorrow around 7pm/);
  expect(state.facts.callbackPreference).toBe("tomorrow around 7pm");
  expect(state.facts.timeline).toBe("Start as soon as possible"); // callback time didn't overwrite the project timeline
});
