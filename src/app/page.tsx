import { Dashboard } from "@/components/Dashboard";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ enquiry?: string }> }) {
  const data = await getDashboardData();
  return <Dashboard initial={data} openId={(await searchParams).enquiry} />;
}
