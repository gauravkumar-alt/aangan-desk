# Setting up the Aangan agent on VaaniVoice (app.vaanivoice.ai)

1. **Agents → Create agent**: name "Aangan Front Desk", language English (India).
2. **Persona / Instructions**: paste `vaani/agent-prompt.md` (the section from "Your job" down).
   **Greeting**: "Good morning, Aangan Studio. I'm the studio's virtual assistant. How can I help you today?"
3. **Knowledge Base**: upload `case/services.md`, `case/qualified.md` and `case/pricing.md`, and attach the KB to the agent.
4. **Analysis (post-call) tab**: paste `vaani/entities-prompt.txt` as the entity-extraction prompt.
5. **Deployment tab**: assign a number as the **Inbound Number** (provision one under Settings → Telephony first). Save.
6. **Settings → Webhooks**: add `https://<public-url>/api/vaani/webhook?token=<VAANI_WEBHOOK_TOKEN from .env.local>`.
7. **Test**: use Test → Testing in the dashboard, or call the inbound number. The call appears on the Aangan dashboard.
