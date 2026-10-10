import { CallSimulator } from "@/components/CallSimulator";
import { demoMode } from "@/lib/notify";
import { loadRuleset } from "@/lib/rules/load";

export const dynamic = "force-dynamic";

export default async function CallPage() {
  return <CallSimulator rules={await loadRuleset()} demo={demoMode()} />;
}
