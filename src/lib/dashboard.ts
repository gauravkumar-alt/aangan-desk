import "server-only";
import { channelStatus, demoMode } from "./notify";
import { loadRuleset } from "./rules/load";
import { ruleAmbiguities, ruleWarnings } from "./rules/schema";
import { getStore } from "./store";
import { vaaniApiConfig } from "./vaani/client";
import { crmStatus } from "./crm";
import { webhookSecret } from "./vaani/webhook";
import { vaaniProvider, webhookToken } from "./vaani/vaanivoice";

export async function getDashboardData() {
  const store = getStore();
  const [enquiries, settings, rules] = await Promise.all([store.listEnquiries(), store.getSettings(), loadRuleset()]);
  const secret = webhookSecret();
  return {
    enquiries,
    settings,
    rules: {
      warnings: ruleWarnings(rules),
      ambiguities: ruleAmbiguities(rules),
      files: [rules.services, rules.qualified, rules.pricing].map((f) => ({ name: f.name, state: f.state, status: f.status })),
      agentMayQuote: rules.pricing.rules?.agentMayQuote ?? false,
    },
    integrations: {
      demo: demoMode(),
      store: store.kind,
      vaani:
        vaaniProvider() === "vaaniyantra"
          ? { provider: "VaaniYantra", apiKey: Boolean(process.env.VAANI_API_KEY), webhookSecret: !secret.demo && Boolean(secret.secret), demoSecret: secret.demo, mockApi: vaaniApiConfig("x")?.mock ?? false }
          : { provider: "VaaniVoice", apiKey: Boolean(process.env.VAANI_API_KEY), webhookSecret: !webhookToken().demo && Boolean(webhookToken().token), demoSecret: webhookToken().demo, mockApi: !process.env.VAANI_API_KEY },
      handoff: channelStatus(),
      crm: crmStatus(),
      calendlyUrl: process.env.CALENDLY_URL || null,
    },
    generatedAt: new Date().toISOString(),
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
