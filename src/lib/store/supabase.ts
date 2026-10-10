import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Enquiry, Settings, WebhookEventRecord } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import type { Store } from "./index";

// Production store. Schema: supabase/migrations/0001_init.sql. The enquiry itself is jsonb so the
// schema can grow without migrations; the columns we query or constrain on are pulled out.
export class SupabaseStore implements Store {
  kind = "supabase" as const;
  private db: SupabaseClient;

  constructor(url: string, key: string) {
    this.db = createClient(url, key, { auth: { persistSession: false } });
  }

  private static check<T>(r: { data: T; error: { message: string } | null }): T {
    if (r.error) throw new Error(`Database error: ${r.error.message}`);
    return r.data;
  }

  async listEnquiries() {
    const rows = SupabaseStore.check(await this.db.from("enquiries").select("data").order("created_at", { ascending: false }).limit(5000));
    return (rows ?? []).map((r: { data: Enquiry }) => r.data);
  }
  async getEnquiry(id: string) {
    const r = SupabaseStore.check(await this.db.from("enquiries").select("data").eq("id", id).maybeSingle());
    return (r as { data: Enquiry } | null)?.data ?? null;
  }
  async findByVaaniCallId(callId: string) {
    const r = SupabaseStore.check(await this.db.from("enquiries").select("data").eq("vaani_call_id", callId).maybeSingle());
    return (r as { data: Enquiry } | null)?.data ?? null;
  }
  async findRecentByPhone(phone: string, sinceIso: string) {
    const rows = SupabaseStore.check(await this.db.from("enquiries").select("data").eq("phone", phone).gte("created_at", sinceIso));
    return (rows ?? []).map((r: { data: Enquiry }) => r.data);
  }
  async saveEnquiry(e: Enquiry) {
    SupabaseStore.check(
      await this.db.from("enquiries").upsert({ id: e.id, vaani_call_id: e.vaaniCallId, phone: e.phone, created_at: e.createdAt, source: e.source, data: e }),
    );
  }
  async deleteEnquiries(filter: (e: Enquiry) => boolean) {
    const all = await this.listEnquiries();
    const ids = all.filter(filter).map((e) => e.id);
    if (ids.length) SupabaseStore.check(await this.db.from("enquiries").delete().in("id", ids));
    return ids.length;
  }
  async claimEvent(rec: WebhookEventRecord) {
    // Primary key on `key` makes this atomic across instances: a retried delivery inserts nothing.
    const inserted = SupabaseStore.check(
      await this.db.from("webhook_events").upsert({ key: rec.key, status: rec.status, received_at: rec.receivedAt, data: rec }, { onConflict: "key", ignoreDuplicates: true }).select("key"),
    );
    if (inserted && inserted.length) return { claimed: true, existing: null };
    const ex = SupabaseStore.check(await this.db.from("webhook_events").select("data").eq("key", rec.key).maybeSingle()) as { data: WebhookEventRecord } | null;
    if (ex?.data.status === "failed") {
      // A previously failed event may be reprocessed — claim it by flipping status only if still failed.
      const flipped = SupabaseStore.check(
        await this.db.from("webhook_events").update({ status: "processing", data: { ...rec, attempts: ex.data.attempts + 1 } }).eq("key", rec.key).eq("status", "failed").select("key"),
      );
      if (flipped && flipped.length) return { claimed: true, existing: ex.data };
    }
    return { claimed: false, existing: ex?.data ?? null };
  }
  async updateEvent(key: string, patch: Partial<WebhookEventRecord>) {
    const ex = SupabaseStore.check(await this.db.from("webhook_events").select("data").eq("key", key).maybeSingle()) as { data: WebhookEventRecord } | null;
    if (!ex) return;
    const data = { ...ex.data, ...patch };
    SupabaseStore.check(await this.db.from("webhook_events").update({ status: data.status, data }).eq("key", key));
  }
  async listEvents(limit: number) {
    const rows = SupabaseStore.check(await this.db.from("webhook_events").select("data").order("received_at", { ascending: false }).limit(limit));
    return (rows ?? []).map((r: { data: WebhookEventRecord }) => r.data);
  }
  async getSettings() {
    const r = SupabaseStore.check(await this.db.from("settings").select("data").eq("id", 1).maybeSingle()) as { data: Settings } | null;
    return { ...DEFAULT_SETTINGS, ...(r?.data ?? {}), rateLabel: DEFAULT_SETTINGS.rateLabel };
  }
  async saveSettings(s: Settings) {
    SupabaseStore.check(await this.db.from("settings").upsert({ id: 1, data: s }));
  }
}
