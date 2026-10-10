# Aangan Studio — Services

## What we do

Aangan Studio offers end-to-end interior design for residential and small commercial spaces across Pune and PCMC.

Our services cover:
- Space planning and layout optimisation
- Material selection (flooring, wall finishes, ceilings)
- Furniture design and curation (custom + sourced)
- Lighting design and specification
- Kitchen and wardrobe design
- Execution supervision — we work with our own network of contractors and vendors

**Residential projects**: apartments, independent houses, villas — full home, specific floors, or individual rooms where the scope is a complete redesign with execution.

**Commercial projects**: offices, clinics, studios — up to approximately 3,000 sq ft. We do not take on retail or hospitality (restaurants, hotels) as primary projects.

## What we don't do

- **Architecture and structural work**: we are interior designers, not architects. We do not move walls, modify the building structure, or handle permits for structural changes.
- **Decor and styling only**: if you want someone to advise on colours or rearrange furniture, we are not the right fit. Our minimum engagement is a room redesign with execution.
- **Standalone furniture sourcing**: we do not source or procure furniture without an associated design project.
- **Vastu consultation only**: we incorporate Vastu requirements into our designs; we do not offer standalone Vastu advisory.
- **Restaurants, hotels, retail stores, gyms**: out of scope.
- **Projects outside our service area**: we serve Pune city and PCMC. Projects in other cities are not something we take on currently.

## Service area

Pune city (including Kothrud, Baner, Aundh, Wakad, Koregaon Park, Kalyani Nagar, Viman Nagar, Hadapsar, Magarpatta, NIBM, Kondhwa, Undri, Shivane, Warje, Erandwane, Deccan, and adjoining areas) and PCMC (Pimpri, Chinchwad, Pimple Saudagar, Pimple Nilakh, Ravet, Hinjewadi).

We do not currently serve Talegaon, Lonavala, Nashik, Mumbai, or other cities outside this area.

## Typical project scope

- **Full home**: 2BHK onwards. End-to-end design and execution.
- **Partial home**: a full floor, or 2+ rooms with execution.
- **Office**: up to ~3,000 sq ft. Includes workstations, cabins, reception, and common areas.
- **Single room**: bedroom or living room — complete redesign with all materials, furniture, and execution included. Not just advice.

## Timelines

- **Design phase**: 3–4 weeks from first consultation
- **Execution**: 8–16 weeks depending on project size and site readiness
- **Minimum lead time**: we cannot begin execution on a project that needs to be ready in under 6 weeks from today.

---

## Machine-readable rules (build mapping — not part of the supplied file)

> Everything above this line is `case/original/services.md` **verbatim**, as supplied by the studio.
> The block below is how the system reads it. Every value points back to a line above. Where the
> text above doesn't settle a question, the value is marked `ambiguity` and shown in the app's
> Rules view instead of being silently decided. Edit the prose and this block together.

```json aangan-rules
{
  "file": "services",
  "status": "approved",
  "source": "case/original/services.md",
  "serviceArea": {
    "regions": [
      "Pune",
      "PCMC"
    ],
    "named": [
      "Kothrud",
      "Baner",
      "Aundh",
      "Wakad",
      "Koregaon Park",
      "Kalyani Nagar",
      "Viman Nagar",
      "Hadapsar",
      "Magarpatta",
      "NIBM",
      "Kondhwa",
      "Undri",
      "Shivane",
      "Warje",
      "Erandwane",
      "Deccan",
      "Pimpri",
      "Chinchwad",
      "Pimple Saudagar",
      "Pimple Nilakh",
      "Ravet",
      "Hinjewadi"
    ],
    "includesAdjoining": true,
    "excluded": [
      "talegaon",
      "lonavala",
      "nashik",
      "mumbai"
    ],
    "excludeOtherCities": true,
    "evidence": [
      "services.md › Service area"
    ],
    "ambiguity": "“…and adjoining areas” — the boundary isn't listed. A locality the system can't place is confirmed with the caller (one direct question, qualified.md › At the boundary)."
  },
  "projectTypes": [
    {
      "id": "residential",
      "label": "Home (apartment, independent house, villa)",
      "inScope": "yes",
      "evidence": [
        "services.md › What we do"
      ]
    },
    {
      "id": "office",
      "label": "Office",
      "inScope": "yes",
      "commercial": true,
      "maxSqFt": 3000,
      "maxIsApproximate": true,
      "evidence": [
        "services.md › What we do",
        "services.md › Typical project scope"
      ]
    },
    {
      "id": "clinic",
      "label": "Clinic",
      "inScope": "yes",
      "commercial": true,
      "maxSqFt": 3000,
      "maxIsApproximate": true,
      "evidence": [
        "services.md › What we do"
      ]
    },
    {
      "id": "studio",
      "label": "Studio",
      "inScope": "yes",
      "commercial": true,
      "maxSqFt": 3000,
      "maxIsApproximate": true,
      "note": "services.md doesn't say what kind of studio.",
      "evidence": [
        "services.md › What we do"
      ]
    },
    {
      "id": "hospitality",
      "label": "Restaurant / hotel",
      "inScope": "no",
      "note": "services.md: not taken on “as primary projects”.",
      "evidence": [
        "services.md › What we do",
        "services.md › What we don't do"
      ]
    },
    {
      "id": "retail",
      "label": "Retail store",
      "inScope": "no",
      "evidence": [
        "services.md › What we do",
        "services.md › What we don't do"
      ]
    },
    {
      "id": "fitness",
      "label": "Gym",
      "inScope": "no",
      "evidence": [
        "services.md › What we don't do"
      ]
    },
    {
      "id": "other_commercial",
      "label": "Other commercial (salon, yoga studio, …)",
      "inScope": "unclear",
      "note": "Neither listed as in scope nor excluded in services.md.",
      "evidence": []
    }
  ],
  "notOffered": [
    {
      "id": "structural",
      "label": "Architecture and structural work — no moving walls, structural changes or permits",
      "evidence": [
        "services.md › What we don't do"
      ]
    },
    {
      "id": "decor_only",
      "label": "Decor and styling only",
      "evidence": [
        "services.md › What we don't do"
      ]
    },
    {
      "id": "furniture_only",
      "label": "Standalone furniture sourcing",
      "evidence": [
        "services.md › What we don't do"
      ]
    },
    {
      "id": "vastu_only",
      "label": "Vastu consultation only",
      "evidence": [
        "services.md › What we don't do"
      ]
    }
  ],
  "minimumEngagement": "A room redesign with execution",
  "scope": {
    "fullHomeFrom": "2BHK",
    "partialHome": "A full floor, or 2+ rooms with execution",
    "singleRoomTypes": [
      "bedroom",
      "living room"
    ],
    "evidence": [
      "services.md › Typical project scope"
    ],
    "ambiguity": "Two cases aren't covered: a 1BHK as a full home (full homes are “2BHK onwards”) and a single room that isn't a bedroom or living room (for example, only a kitchen). These are flagged in the handoff, not rejected."
  },
  "leadTimes": {
    "designPhaseWeeks": [
      3,
      4
    ],
    "executionWeeks": [
      8,
      16
    ],
    "minLeadWeeks": 6,
    "evidence": [
      "services.md › Timelines"
    ]
  },
  "hours": {
    "open": "10:00",
    "close": "19:00",
    "days": [
      1,
      2,
      3,
      4,
      5
    ],
    "timezone": "Asia/Kolkata",
    "evidence": [
      "Case brief: front desk covers 10am–7pm",
      "Transcript W05"
    ],
    "ambiguity": "The supplied files don't give working days. Weekends are treated as closed because of one WhatsApp reply (W05)."
  }
}
```
