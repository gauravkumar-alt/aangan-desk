# Aangan Studio — AI phone front desk

Every inbound call to Aangan Studio is answered right away, day or night. The AI qualifies the caller
against Nikhil's own rubric and sends designers what they need without re-asking. A founder dashboard
shows whether calls are answered fast enough, which ones reached designers, and what the system costs.

**In scope:** incoming phone calls only. WhatsApp and the web form are out of scope (see "Extending").

```bash
npm install
npm run dev        # http://localhost:3200  (demo mode: no keys needed)
npm test           # 23 end-to-end scenario tests
```

## How it works

```
Caller ─► Vaani (VaaniYantra) voice agent ── answers, converses, fills collectedData
              │  call.completed / call.failed webhook (HMAC-SHA256 signed)
              ▼
  /api/vaani/webhook ─ verify signature ─ claim idempotency key ─ STORE ENQUIRY ─ 200 OK  (< 6s)
              │ after response
              ├─► GET /api/v1/calls/:id (transcript, pickup time) ─ re-qualify       [may fail → kept, retryable]
              └─► Notifier (Telegram | email) ─ designer handoff + 📅 calendar link [may fail → HANDOFF PENDING]
                                                                             ▲ retry: dashboard button / cron
  case/services.md · qualified.md · pricing.md  ──►  rules engine (qualify.ts, pricing.ts)
  Dashboard (/) · Call simulator (/test a call) · Rules (/rules)
```

| Component map | Implementation |
|---|---|
| **Trigger:** incoming phone call | VaaniYantra number (Twilio, Plivo or Exotel) → agent → webhook `src/app/api/vaani/webhook` |
| **Input:** caller, project, location, area, rooms, timeline, budget… | `collectedData` + transcript → `src/lib/vaani/normalize.ts`, `src/lib/extract.ts` |
| **Context:** services, rules, pricing, hours, handoff rules | `case/*.md`, loaded at runtime by `src/lib/rules/load.ts` |
| **Processing:** normalise, project type, service fit, criteria, missing info, pricing, next action | `src/lib/qualify.ts`, `src/lib/pricing.ts`, `src/lib/process.ts` |
| **AI:** natural voice conversation | Vaani agent (`vaani/agent-prompt.md`); demo engine `src/lib/agent/dialogue.ts` follows the same policy |
| **Output:** record, status, internal price, handoff, Telegram, metrics | `src/lib/store`, `src/lib/handoff.ts`, `src/lib/notify/*`, `src/lib/metrics.ts`, `src/components/Dashboard.tsx` |

## The case files drive the rules — and one of them overrides the brief

`case/services.md`, `case/qualified.md` and `case/pricing.md` are the studio's files, **verbatim**. The
originals are in `case/original/`. Each file ends with a machine-readable `json aangan-rules` block that
cites the text above it. Edit a file and the next call uses the change. `/rules` lists every open question.

**The cut.** Nikhil asked for the system to "quote our standard per-square-foot pricing so people don't
have to wait". His own `pricing.md` says the agent must never say "any specific number, range, or
per-sq-ft figure", and gives the only acceptable reply. The build follows `pricing.md`:

- The agent deflects pricing questions with that exact line.
- An indicative range is still computed from the real rates, but only for the designer's handoff (marked
  INTERNAL) and the dashboard's estimated pipeline.
- Allowing quotes is one switch (`"agentMayQuote": true` in `case/pricing.md`). That's Nikhil's decision
  to make, not the system's.

**Qualification** (`qualified.md`, all five criteria):

| | Rule | Result if it fails |
|---|---|---|
| 1 | Real project: design + execution. Not advice, decor, furniture-only, Vastu-only or DIY execution | NOT QUALIFIED |
| 2 | Pune city or PCMC. Talegaon, Lonavala, Nashik and Mumbai are out | NOT QUALIFIED |
| 3 | Timeline: not under 6 weeks (`services.md`); site available within 8–10 weeks | NOT QUALIFIED |
| 4 | Budget: never asked. A volunteered figure below the lowest `pricing.md` cost for that scope fails | NOT QUALIFIED |
| 5 | Decision-maker, or authorised to go ahead | NOT QUALIFIED if explicitly not |

Unclear on 1–3: the agent asks one direct question. If it's still unclear, the enquiry goes to
**NEEDS REVIEW** (the rubric doesn't say what to do here, so a person decides). Unclear on 4–5: treated as
qualified, with the uncertainty noted in the handoff. Two or more failures: the rubric's own decline line.
Service scope from `services.md` (restaurants, hotels, retail and gyms out; commercial up to ~3,000 sq ft)
is checked too. Existing-client complaints are escalated (front-desk practice, T09), not qualified.

**Open questions flagged, not decided** (`/rules`):
- What counts as "adjoining areas".
- Deadlines between 6 weeks and the ~11 weeks that design plus execution take.
- The 8–10 week site-availability band.
- A 1BHK as a "full home", and a kitchen-only single room.
- What "studios" covers.
- The threshold for a budget that's "clearly below".
- Weekend hours.
- Commercial minimum size: the front desk declined a 180 sq ft pod (T18), but `services.md` sets no minimum.

## What's real vs simulated in demo mode

| | Real | Simulated / assumed (labelled in the UI) |
|---|---|---|
| Vaani webhook | Real endpoint, VaaniYantra's documented payload, HMAC-SHA256 signature check, idempotency | In demo the simulator signs with a demo secret when `VAANI_WEBHOOK_SECRET` isn't set |
| Vaani API | Real client for `GET /api/v1/calls/:id` | Without `VAANI_API_KEY`, it calls an in-app mock of that endpoint |
| Voice | The browser simulator uses real speech in/out (Web Speech API) | The conversation is the demo engine, not Vaani's LLM |
| Telegram | Real Bot API `sendMessage` (HTML), timeouts, retryable errors | Without a token in demo, handoffs go to a labelled "Demo inbox" |
| Data | September replay = the 20 real phone transcripts, run through the pipeline | Replay pickup time (3s); replay handoffs never go to Telegram |
| Cost | Duration × rate, per call, transparent | ₹5/min = VaaniYantra's published "from ₹5/minute"; per-client rates differ, so it's editable in Settings |
| Revenue | Only projects a person marks **won** | Pipeline is an estimate; there are no conversion numbers until outcomes are recorded |

## Vaani integration (VaaniYantra, vaaniyantra.com/docs/developer-guide)

1. Create the agent with `vaani/agent-prompt.md`. Attach the three `case/*.md` files as knowledge and
   configure the collected-data fields in `vaani/collected-data-fields.json`.
2. Import a number (Twilio or Plivo get webhooks automatically; Exotel needs manual setup) and attach the agent.
3. Settings → Webhooks → `https://<host>/api/vaani/webhook`, events `call.completed` and `call.failed`.
   Put the `whsec_` secret in `VAANI_WEBHOOK_SECRET`.
4. Settings → API keys → a `calls:read` key in `VAANI_API_KEY` (for transcripts and pickup time).

**Webhook safety:**
- Raw-body HMAC is checked with a constant-time compare, guarded on length.
- Without a secret outside demo mode, every webhook is refused.
- Each event is keyed on `(event, call id)` by a primary key, so retries and concurrent duplicates become
  no-ops that return `{duplicate: true}`.
- The enquiry is saved before the 200 response. The transcript fetch and the handoff run after it.
- Failed events keep their raw body and can be reprocessed (`POST /api/events`).
- Outbound calls are ignored.

## Handoff: why Telegram

It's an urgent lead. An enquiry answered within an hour converts at 4× the rate of a next-day one, so the
designer needs it on their phone in seconds, in a compact message they can act on with one tap. Email
sits in an inbox. The note carries everything the AI asked: name, phone, location, project, property,
area, rooms, timeline, budget (only if volunteered), decision-maker, internal pricing, qualification and
reason, corrections, uncertainties and the next step, plus a 📅 link to schedule the consultation.

Channels sit behind one `Notifier` interface (`src/lib/notify`). Switching to email is
`HANDOFF_CHANNEL=email`, using Resend with the same note. If a send fails, the enquiry stays stored and
shows **HANDOFF PENDING** with the error. Retry from the dashboard or the cron (`vercel.json`). A sent
handoff is never sent twice.

## CRM: Zoho (HubSpot also supported)

After the designer handoff, the enquiry is synced to the CRM. It never blocks the handoff, and a failure
shows "sync pending" with a retry.

- **Zoho** (`CRM_PROVIDER=zoho`, works on the Free edition's 5,000 API credits a day):
  1. Every caller becomes a Lead, matched on Phone so repeat callers update the same Lead.
  2. Lead_Status is set from the qualification, and a note carries the full summary.
  3. A qualified Lead is converted once into a Contact plus a Deal. The Amount is the low end of the
     internal range, labelled as an estimate. The closing date is a placeholder.
- **HubSpot** (`CRM_PROVIDER=hubspot`): a Contact, a note, and a Deal for qualified enquiries.

Replayed and anonymised calls are never written to the CRM. Setup is in `.env.example`.

## Consultation scheduling

This is deliberately light; the original brief excluded a scheduling system. Each designer handoff gets a
pre-filled Google Calendar event link (in Telegram and the dashboard) and an `.ics` invite
(`/api/enquiries/:id/invite`). The designer confirms the slot with the caller and marks it **booked**,
which feeds the funnel's "Consultation booked" stage.

## AI cost

Per call: `ceil(duration / billing increment) × (Vaani ₹/min + telephony ₹/min)`, stored on each enquiry
with its working. If Vaani ever reports a billed cost (`collectedData.cost_inr`), that figure is used
instead. Changing the rate recalculates every call. The dashboard shows total cost, cost per enquiry and
cost per qualified enquiry. **₹5/min is an assumption**: VaaniYantra's published starting rate, not an
invoice.

## Test scenarios (`npm test`, and one-click in "Test a call")

1. Qualified home
2. Out of area / restaurant / two criteria failing
3. After hours
4. Unknown square footage
5. Asks for pricing first
6. Changes an answer
7. Hangs up early / refuses to answer / dropped call merged with the call-back
8. Telegram failure → PENDING → retry → SENT
9. Vaani API failure, bad signature, missing secret, missed call
10. Duplicate and concurrent duplicate webhooks

Also tested: budget clearly too low, a deadline under 6 weeks, a family member researching, an existing
client escalation, an unrecognised locality, and a replay of all 20 September phone transcripts.

## For production

- Set `DEMO_MODE=false`, the Vaani secret and key, the Telegram token and chat, and Supabase (run
  `supabase/migrations/0001_init.sql`). Set `APP_PASSWORD` or put SSO in front.
- Point a real Vaani number at the agent and run real calls. Tune the agent prompt on the transcripts.
- Confirm the open questions on `/rules` with Nikhil, especially pricing.
- Get the real Vaani rate card (and telephony billing) into Settings.
- Move after-response work to a durable queue (for example Vercel Queues or Inngest) instead of
  in-process `after()`. Make the handoff lock database-backed for multiple instances. Vercel Hobby only
  allows daily crons, so use Pro or an external scheduler for the 10-minute retry.
- Calendar: Google Calendar API or a Cal.com booking link so the AI can offer real slots.
- Extending to WhatsApp and the web form: those would be new inputs into the same `ingestCall` pipeline.
  Rules, handoff and dashboard stay unchanged.
