import "server-only";
import type { Notifier } from "./index";

// Demo mode only: when no real channel is configured, the handoff lands in the app's own
// "Designer inbox" view instead. It is always labelled as such — it never pretends to be Telegram.
export function demoInboxNotifier(reason: string): Notifier {
  return {
    id: "demo-inbox",
    label: `Demo designer inbox (${reason})`,
    configured: true,
    async send() {
      return { ok: true, externalId: `demo-${Date.now()}` };
    },
  };
}
