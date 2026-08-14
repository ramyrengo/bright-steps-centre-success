import { BusinessWorkspaceGate } from "@/components/app-shell";
import { CentreBudgetMonth } from "@/components/centre-budget-month";

export default async function CentreBudgetPage({
  params,
}: Readonly<{ params: Promise<{ centreId: string }> }>) {
  const { centreId } = await params;
  return (
    <BusinessWorkspaceGate>
      <CentreBudgetMonth centreId={centreId} />
    </BusinessWorkspaceGate>
  );
}
