import { z } from "zod";

// VaaniYantra webhook body: { event, timestamp, data: { …call } } (developer guide → Webhooks).
// Lenient on purpose: unknown fields pass through, and a missing optional field must never cost us the
// enquiry. `transcript` is NOT part of the documented webhook — it's fetched from GET /api/v1/calls/:id.

export const TranscriptItem = z.object({
  role: z.string(),
  text: z.string(),
  atMs: z.number().optional(),
});

export const VaaniCall = z
  .object({
    id: z.string().min(1),
    direction: z.string().nullish(),
    status: z.string().nullish(),
    fromNumber: z.string().nullish(),
    toNumber: z.string().nullish(),
    durationSec: z.number().nullish(),
    language: z.string().nullish(),
    agent: z.object({ id: z.string().nullish(), name: z.string().nullish() }).passthrough().nullish(),
    summary: z.string().nullish(),
    sentiment: z.string().nullish(),
    sentimentScore: z.number().nullish(),
    topics: z.array(z.string()).nullish(),
    collectedData: z.record(z.string(), z.unknown()).nullish(),
    recordingUrl: z.string().nullish(),
    createdAt: z.string().nullish(),
    startedAt: z.string().nullish(),
    endedAt: z.string().nullish(),
    transcript: z.array(TranscriptItem).nullish(),
  })
  .passthrough();

export const VaaniWebhook = z
  .object({
    event: z.string(),
    timestamp: z.string().nullish(),
    data: VaaniCall,
  })
  .passthrough();

export type VaaniCall = z.infer<typeof VaaniCall>;
export type VaaniWebhook = z.infer<typeof VaaniWebhook>;

/** One enquiry per call per event type. The docs define no event ID, so (event, call id) is the key. */
export const idempotencyKey = (p: Pick<VaaniWebhook, "event"> & { data: { id: string } }) => `${p.event}:${p.data.id}`;
