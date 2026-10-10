# Aangan Studio — Internal Pricing Guide

> ⚠️ **This guide is indicative only. Pricing varies by site, materials specification, and project complexity. No number from this guide should be quoted to a client. All pricing is confirmed by the assigned designer at the consultation.**

## Residential

| Project type | Indicative range |
|---|---|
| Standard specification | ₹1,800 – ₹2,400 per sq ft |
| Premium specification | ₹2,400 – ₹3,500 per sq ft |
| Luxury specification | ₹3,500+ per sq ft |

*Sq ft refers to carpet area of designed space, not built-up area.*

Single room redesign (all-in): ₹3.5 lakh – ₹8 lakh depending on room size and specification.

## Commercial (office / clinic / studio)

| Project type | Indicative range |
|---|---|
| Basic fitout | ₹1,200 – ₹1,800 per sq ft |
| Mid-range office | ₹1,800 – ₹2,800 per sq ft |
| Premium office | ₹2,800 – ₹4,000 per sq ft |

## What affects pricing

- **Site condition**: existing flooring or ceilings that can be retained reduce cost significantly
- **Custom furniture ratio**: more custom = higher cost; more sourced = variable
- **Material brands**: tile brands, fitting brands, wood grade — the spread across tiers is significant
- **Timeline compression**: fast-track execution carries a premium

## What the agent must never say

- Any specific number, range, or per-sq-ft figure
- "It'll cost around..."
- "Our rates start at..."
- "For a 2BHK it's typically..."

**The only acceptable response to a pricing question**: "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like."

---

## Machine-readable rules (build mapping — not part of the supplied file)

> Everything above this line is `case/original/pricing.md` **verbatim**, as supplied by the studio.
> The block below is how the system reads it. Every value points back to a line above. Where the
> text above doesn't settle a question, the value is marked `ambiguity` and shown in the app's
> Rules view instead of being silently decided. Edit the prose and this block together.

```json aangan-rules
{
  "file": "pricing",
  "status": "approved",
  "source": "case/original/pricing.md",
  "agentMayQuote": false,
  "approvedResponse": "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like.",
  "disclaimer": "Indicative only — internal. Pricing varies by site, materials specification, and project complexity. Confirmed by the assigned designer at the consultation. Never quoted to the caller.",
  "basis": "carpet area of designed space",
  "residential": {
    "tiers": [
      {
        "id": "standard",
        "label": "Standard",
        "minPerSqFt": 1800,
        "maxPerSqFt": 2400
      },
      {
        "id": "premium",
        "label": "Premium",
        "minPerSqFt": 2400,
        "maxPerSqFt": 3500
      },
      {
        "id": "luxury",
        "label": "Luxury",
        "minPerSqFt": 3500,
        "maxPerSqFt": null
      }
    ],
    "singleRoom": {
      "minInr": 350000,
      "maxInr": 800000
    }
  },
  "commercial": {
    "appliesTo": [
      "office",
      "clinic",
      "studio"
    ],
    "tiers": [
      {
        "id": "basic",
        "label": "Basic fitout",
        "minPerSqFt": 1200,
        "maxPerSqFt": 1800
      },
      {
        "id": "mid",
        "label": "Mid-range office",
        "minPerSqFt": 1800,
        "maxPerSqFt": 2800
      },
      {
        "id": "premium",
        "label": "Premium office",
        "minPerSqFt": 2800,
        "maxPerSqFt": 4000
      }
    ]
  },
  "defaultTier": {
    "residential": "standard",
    "commercial": "basic",
    "ambiguity": "Callers rarely state a specification. The internal estimate uses the lowest tier unless the caller mentions premium or luxury. The higher tiers are shown next to it."
  },
  "partialScope": {
    "rule": "designer-quote",
    "ambiguity": "pricing.md has no rate for 2+ rooms, and callers give the area of the whole flat, not of the designed space. So no estimate is made."
  },
  "conflict": "Nikhil asked for the system to quote standard per-sq-ft pricing to callers. pricing.md says the agent must never state any number. The agent follows pricing.md; the range is used internally only. Nikhil to decide."
}
```
