import { BusinessWorkspaceGate } from "@/components/app-shell";
import { ConnectedCentreStandardsWorkspace } from "@/components/centre-standards-connected";

export default function CentreStandardsPage() {
  return (
    <BusinessWorkspaceGate>
      <ConnectedCentreStandardsWorkspace />
    </BusinessWorkspaceGate>
  );
}
