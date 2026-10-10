import "server-only";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import type { Enquiry, Settings, WebhookEventRecord } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import type { Store } from "./index";

interface Shape {
  enquiries: Record<string, Enquiry>;
  events: Record<string, WebhookEventRecord>;
  settings: Settings;
}

// Single-process JSON store for local runs and the demo. Writes are serialised through a promise
// chain and land atomically (write temp → rename), so a crash mid-write can't corrupt the file.
// On Vercel only /tmp is writable and it doesn't persist — use Supabase there.
export class FileStore implements Store {
  kind = "file" as const;
  private file: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor() {
    const dir = process.env.DATA_DIR || (process.env.VERCEL ? "/tmp/aangan-desk" : path.join(process.cwd(), "data"));
    this.file = path.join(dir, "store.json");
  }

  private async read(): Promise<Shape> {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as Partial<Shape>;
      return { enquiries: raw.enquiries ?? {}, events: raw.events ?? {}, settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}), rateLabel: DEFAULT_SETTINGS.rateLabel } };
    } catch {
      return { enquiries: {}, events: {}, settings: { ...DEFAULT_SETTINGS } };
    }
  }

  private async write(d: Shape) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(d));
    await rename(tmp, this.file);
  }

  /** Run a read-modify-write under the lock. */
  private tx<T>(fn: (d: Shape) => T | Promise<T>, mutate = true): Promise<T> {
    const run = this.chain.then(async () => {
      const d = await this.read();
      const out = await fn(d);
      if (mutate) await this.write(d);
      return out;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  listEnquiries() {
    return this.tx((d) => Object.values(d.enquiries).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), false);
  }
  getEnquiry(id: string) {
    return this.tx((d) => d.enquiries[id] ?? null, false);
  }
  findByVaaniCallId(callId: string) {
    return this.tx((d) => Object.values(d.enquiries).find((e) => e.vaaniCallId === callId) ?? null, false);
  }
  findRecentByPhone(phone: string, sinceIso: string) {
    return this.tx((d) => Object.values(d.enquiries).filter((e) => e.phone === phone && e.createdAt >= sinceIso), false);
  }
  saveEnquiry(e: Enquiry) {
    return this.tx((d) => {
      d.enquiries[e.id] = e;
    });
  }
  deleteEnquiries(filter: (e: Enquiry) => boolean) {
    return this.tx((d) => {
      let n = 0;
      for (const [id, e] of Object.entries(d.enquiries)) if (filter(e)) (delete d.enquiries[id], n++);
      return n;
    });
  }
  claimEvent(rec: WebhookEventRecord) {
    return this.tx((d) => {
      const existing = d.events[rec.key];
      if (existing && existing.status !== "failed") return { claimed: false, existing };
      d.events[rec.key] = { ...rec, attempts: (existing?.attempts ?? 0) + 1 };
      return { claimed: true, existing: existing ?? null };
    });
  }
  updateEvent(key: string, patch: Partial<WebhookEventRecord>) {
    return this.tx((d) => {
      if (d.events[key]) d.events[key] = { ...d.events[key], ...patch };
    });
  }
  listEvents(limit: number) {
    return this.tx((d) => Object.values(d.events).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, limit), false);
  }
  getSettings() {
    return this.tx((d) => d.settings, false);
  }
  saveSettings(s: Settings) {
    return this.tx((d) => {
      d.settings = s;
    });
  }
}
