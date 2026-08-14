import { BusinessWorkspaceGate } from "@/components/app-shell";
import { PortfolioBudgetMonth } from "@/components/portfolio-budget-month";

export default function BudgetsPage() {
  return (
    <BusinessWorkspaceGate>
      <PortfolioBudgetMonth />
    </BusinessWorkspaceGate>
  );
}
