import "server-only";
import { readdir, readFile } from "fs/promises";
import path from "path";
import type { CallInput } from "./process";
import { dispatchHandoff, ingestCall } from "./process";
import { getStore } from "./store";
import type { TranscriptTurn } from "./types";

// Demo data: the 20 real Sep 2026 PHONE transcripts from case/enquiries/, run through the same
// pipeline a live Vaani call goes through. Nothing is made up — the only simulated value is the AI
// pickup time (the front desk's real pickup times weren't recorded). Handoffs for replayed calls go to
// the in-app demo inbox, never to Telegram.

const DIR = path.join(process.cwd(), "case", "enquiries");
const SIMULATED_PICKUP_SEC = 3;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function istToIso(day: number, monthName: string, time: string, year = 2026): string {
  const m = MONTHS.indexOf(monthName.toLowerCase());
  const t = /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(time)!;
  let h = Number(t[1]) % 12;
  if (t[3].toLowerCase() === "pm") h += 12;
  return new Date(Date.UTC(year, m, day, h, Number(t[2])) - 330 * 60_000).toISOString();
}

const dur = (s: string) => {
  const m = /(\d+)\s*min\s*(\d+)?\s*(?:sec)?/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2] ?? 0) : 0;
};

function parseTurns(body: string): { turns: TranscriptTurn[]; notes: string[] } {
  const turns: TranscriptTurn[] = [];
  const notes: string[] = [];
  let cur: TranscriptTurn | null = null;
  let inNote = false;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("<!--")) continue;
    const fd = /^Front Desk:\s*(.*)$/.exec(line);
    const cl = /^Caller:\s*(.*)$/.exec(line);
    const nt = /^Note:\s*(.*)$/.exec(line);
    if (fd || cl) {
      cur = { role: fd ? "AGENT" : "CALLER", text: (fd ?? cl)![1] };
      turns.push(cur);
      inNote = false;
    } else if (nt) {
      notes.push(nt[1]);
      inNote = true;
      cur = null;
    } else if (inNote) notes[notes.length - 1] += ` ${line}`;
    else if (cur) cur.text += ` ${line}`;
  }
  return { turns, notes };
}

export async function loadPhoneReplays(): Promise<CallInput[]> {
  const files = (await readdir(DIR)).filter((f) => /^T\d{2}\.md$/.test(f)).sort();
  const inputs: CallInput[] = [];
  for (const f of files) {
    const id = f.replace(".md", "");
    const text = await readFile(path.join(DIR, f), "utf8");
    const lines = text.split("\n").filter((l) => !l.startsWith("<!--"));
    const header = lines[0];
    const h = /^T\d{2} · Phone · (\d{1,2}) (\w+) · ([\d:]+\s*[ap]m)(.*)$/i.exec(header);
    if (!h) continue;
    const [, day, month, time, rest] = h;
    const createdAt = istToIso(Number(day), month, time);
    const base = { source: "replay" as const, vaaniCallId: null, phone: null, collectedData: null, summary: null };

    if (/MISSED CALL/i.test(rest)) {
      const { notes } = parseTurns(lines.slice(1).join("\n"));
      const extra = lines.slice(1).join(" ").trim();
      inputs.push({
        ...base,
        replayOf: id,
        createdAt,
        answeredAt: null,
        endedAt: createdAt,
        durationSec: 0,
        status: "missed",
        transcript: [],
        transcriptStatus: "not_available",
        notes: `Sep 2026 record: ${[extra, ...notes].join(" ")} The AI desk answers 24/7; this replay only reprocesses calls that have a transcript.`,
      });
      continue;
    }

    if (/then/.test(rest)) {
      // T17: a dropped call and the immediate call-back, kept as two calls and linked.
      const secondAt = /then\s*([\d:]+\s*[ap]m)/i.exec(rest)?.[1] ?? time;
      const body = lines.slice(1).join("\n");
      const [firstPart, secondPart] = body.split(/^Second call.*$/m);
      const firstDur = dur(/disconnected at ([^\n]+)/.exec(firstPart)?.[1] ?? "");
      const secondDur = dur(/^Second call — (.+)$/m.exec(body)?.[1] ?? "");
      const first = parseTurns(firstPart.replace(/^First call.*$/m, ""));
      const second = parseTurns(secondPart ?? "");
      const firstAt = createdAt;
      inputs.push({
        ...base,
        replayOf: `${id}a`,
        createdAt: firstAt,
        answeredAt: new Date(new Date(firstAt).getTime() + SIMULATED_PICKUP_SEC * 1000).toISOString(),
        endedAt: new Date(new Date(firstAt).getTime() + firstDur * 1000).toISOString(),
        durationSec: firstDur,
        status: "hung_up_early",
        transcript: first.turns,
        transcriptStatus: "complete",
        notes: "Line dropped mid-sentence.",
      });
      const secondIso = istToIso(Number(day), month, secondAt);
      inputs.push({
        ...base,
        replayOf: id,
        createdAt: secondIso,
        answeredAt: new Date(new Date(secondIso).getTime() + SIMULATED_PICKUP_SEC * 1000).toISOString(),
        endedAt: new Date(new Date(secondIso).getTime() + secondDur * 1000).toISOString(),
        durationSec: secondDur,
        status: "completed",
        transcript: second.turns,
        transcriptStatus: "complete",
        notes: second.notes.join(" "),
        previousEnquiryId: `enq_replay_${id}a`,
      });
      continue;
    }

    const d = dur(rest);
    const { turns, notes } = parseTurns(lines.slice(1).join("\n"));
    inputs.push({
      ...base,
      replayOf: id,
      createdAt,
      answeredAt: new Date(new Date(createdAt).getTime() + SIMULATED_PICKUP_SEC * 1000).toISOString(),
      endedAt: new Date(new Date(createdAt).getTime() + d * 1000).toISOString(),
      durationSec: d,
      status: "completed",
      transcript: turns,
      transcriptStatus: "complete",
      notes: notes.join(" "),
    });
  }
  return inputs;
}

/** Replace replayed demo data with a fresh run (live/simulated calls are untouched). */
export async function seedReplays() {
  const store = getStore();
  await store.deleteEnquiries((e) => e.source === "replay");
  const inputs = await loadPhoneReplays();
  for (const input of inputs) {
    const e = await ingestCall(input);
    if (e.handoff.required) await dispatchHandoff(e.id);
  }
  return inputs.length;
}
