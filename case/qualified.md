# What makes an enquiry worth a designer's time

*Written by Nikhil Deshpande. This is my rubric — use this to decide.*

An enquiry reaches a designer when it passes all five criteria below. If any one is unclear, ask one direct question. If it fails one, close gracefully — don't forward an incomplete lead.

## The five criteria

### 1. Real project — not just advice
The person wants design and execution, not a consultation or a second opinion. Red flags: "just looking for ideas," "can you come and advise," "I'll do the execution myself." Our minimum engagement is a room redesign with full execution.

### 2. In our service area
Pune city or PCMC. If the site is in Talegaon, Nashik, Mumbai, or anywhere outside our area — decline politely. We don't have the vendor network outside Pune.

### 3. Realistic timeline
The site must be available for execution within 8–10 weeks of the consultation. If someone needs it done in 3 weeks, we cannot serve them well. Ask: "When would you need the project complete?" — if the answer makes execution impossible, say so honestly.

### 4. Right budget band (broadly)
Don't quote. Don't probe. But if a caller volunteers a number that is clearly below what any project of their described scope would cost — for example, ₹1–1.5 lakh for a full flat redesign — address the misalignment on the call. It's kinder than discovering it at consultation. If budget is not mentioned, treat as qualified.

### 5. Decision-maker on the call (or represented)
The person should be the one who decides, or calling on behalf of someone who has authorised them to move forward. "My spouse wants to do this but they're not available" is fine if the caller confirms they're authorised. "I'm just doing initial research for my in-laws" is not sufficient on its own.

## At the boundary

- **Unclear on 1, 2, or 3**: ask one direct question.
- **Unclear on 4 or 5**: do not push. Treat as qualified and note the uncertainty in the handoff note.
- **Two or more criteria fail**: decline gracefully. "This sounds like it may not be the right fit for us right now — but feel free to reach out if your timeline or scope changes."

## What does NOT disqualify

- Not knowing exactly what they want (that's the consultation's job)
- Calling outside office hours (answer, qualify, book)
- Asking for pricing (deflect, but do not disqualify)
- Being uncertain about materials, style, or layout
- A single room project (one room with full execution is fine)
- A rented apartment (fine, as long as no structural changes)

## The question I get asked most

*"What if the budget doesn't match but they haven't said so?"*

Don't probe. If they volunteer a number that clearly fails, note it and do not forward. If they don't mention budget, forward the lead. The designer establishes fit at the consultation. Your job is to catch obvious misalignments — not to pre-qualify every variable the designer can handle in person.

---

## Machine-readable rules (build mapping — not part of the supplied file)

> Everything above this line is `case/original/qualified.md` **verbatim**, as supplied by the studio.
> The block below is how the system reads it. Every value points back to a line above. Where the
> text above doesn't settle a question, the value is marked `ambiguity` and shown in the app's
> Rules view instead of being silently decided. Edit the prose and this block together.

```json aangan-rules
{
  "file": "qualified",
  "status": "approved",
  "source": "case/original/qualified.md",
  "criteria": [
    {
      "id": "c1_real_project",
      "n": 1,
      "label": "Real project — not just advice",
      "ifUnclear": "ask",
      "question": "Would you be looking at design and execution together?",
      "evidence": [
        "qualified.md › 1. Real project"
      ]
    },
    {
      "id": "c2_service_area",
      "n": 2,
      "label": "In our service area",
      "ifUnclear": "ask",
      "question": "Is that within Pune city or PCMC?",
      "evidence": [
        "qualified.md › 2. In our service area"
      ]
    },
    {
      "id": "c3_timeline",
      "n": 3,
      "label": "Realistic timeline",
      "ifUnclear": "ask",
      "question": "When would you need the project complete?",
      "siteAvailableWithinWeeks": [
        8,
        10
      ],
      "evidence": [
        "qualified.md › 3. Realistic timeline",
        "services.md › Timelines"
      ]
    },
    {
      "id": "c4_budget",
      "n": 4,
      "label": "Right budget band (broadly)",
      "ifUnclear": "qualify_and_note",
      "neverAsk": true,
      "evidence": [
        "qualified.md › 4. Right budget band"
      ]
    },
    {
      "id": "c5_decision_maker",
      "n": 5,
      "label": "Decision-maker on the call (or represented)",
      "ifUnclear": "qualify_and_note",
      "evidence": [
        "qualified.md › 5. Decision-maker"
      ]
    }
  ],
  "onSingleFail": "Close gracefully — don't forward.",
  "twoOrMoreFailLine": "This sounds like it may not be the right fit for us right now — but feel free to reach out if your timeline or scope changes.",
  "unresolvedAfterQuestion": {
    "outcome": "NEEDS_REVIEW",
    "ambiguity": "The rubric says to ask one direct question when 1, 2 or 3 is unclear, but not what to do if it's still unclear after the call. The system sends those to a person rather than guessing."
  },
  "doesNotDisqualify": [
    "Not knowing exactly what they want",
    "Calling outside office hours",
    "Asking for pricing",
    "Being uncertain about materials, style, or layout",
    "A single room project",
    "A rented apartment (as long as no structural changes)"
  ],
  "routing": [
    {
      "id": "existing_client",
      "label": "Existing client with a project issue",
      "action": "Escalate to the studio head; senior callback within 15 minutes.",
      "evidence": [
        "Transcript T09"
      ],
      "note": "From front-desk practice in the transcripts — not part of qualified.md."
    }
  ],
  "handoffFlags": [
    {
      "id": "referral",
      "label": "Referral — call back fast",
      "evidence": [
        "Transcripts T01, T05, W06"
      ]
    },
    {
      "id": "repeat_caller",
      "label": "Called before, not followed up — handle with care",
      "evidence": [
        "Transcripts T16, W08"
      ]
    },
    {
      "id": "large_project",
      "label": "Large home — consider a principal designer site visit",
      "minSqFt": 3000,
      "evidence": [
        "Transcript T12"
      ]
    }
  ]
}
```
