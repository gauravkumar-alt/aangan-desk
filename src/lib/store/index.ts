import "server-only";
import type { Enquiry, Settings, WebhookEventRecord } from "../types";
import { FileStore } from "./file";
import { SupabaseStore } from "./supabase";

// Storage behind one interface. Local/demo: a JSON file. Production: Supabase (set SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY and run supabase/migrations). Nothing else in the app knows which.

export interface Store {
  kind: "file" | "supabase";
  listEnquiries(): Promise<Enquiry[]>;
  getEnquiry(id: string): Promise<Enquiry | null>;
  findByVaaniCallId(callId: string): Promise<Enquiry | null>;
  findRecentByPhone(phone: string, sinceIso: string): Promise<Enquiry[]>;
  saveEnquiry(e: Enquiry): Promise<void>;
  deleteEnquiries(filter: (e: Enquiry) => boolean): Promise<number>;

  /** Atomically claim an idempotency key. Returns false if it was already claimed (duplicate delivery). */
  claimEvent(rec: WebhookEventRecord): Promise<{ claimed: boolean; existing: WebhookEventRecord | null }>;
  updateEvent(key: string, patch: Partial<WebhookEventRecord>): Promise<void>;
  listEvents(limit: number): Promise<WebhookEventRecord[]>;

  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
}

let instance: Store | null = null;

export function getStore(): Store {
  if (instance) return instance;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  instance = url && key ? new SupabaseStore(url, key) : new FileStore();
  return instance;
}
