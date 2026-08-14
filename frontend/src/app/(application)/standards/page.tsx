import { BusinessWorkspaceGate } from "@/components/app-shell";
import { CentreStandardsWorkspace } from "@/components/centre-standards-workspace";

export default function CentreStandardsPage() {
  return (
    <BusinessWorkspaceGate>
      <CentreStandardsWorkspace />
    </BusinessWorkspaceGate>
  );
}
