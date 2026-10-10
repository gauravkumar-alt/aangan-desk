import { Dashboard } from "@/components/Dashboard";
import { getDashboardData } from "@/lib/dashboard";
import { demoMode } from "@/lib/notify";
import { seedReplays } from "@/lib/replay";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ enquiry?: string }> }) {
  // First run in demo mode: load September's real phone transcripts so the dashboard isn't empty.
  if (demoMode() && (await getStore().listEnquiries()).length === 0) await seedReplays();
  const data = await getDashboardData();
  return <Dashboard initial={data} openId={(await searchParams).enquiry} />;
}
