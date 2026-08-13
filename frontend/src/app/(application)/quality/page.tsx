import { BusinessWorkspaceGate } from "@/components/app-shell";
import { QualityWorkspace } from "@/components/quality-workspace";

export default function QualityPage() {
  return (
    <BusinessWorkspaceGate>
      <QualityWorkspace />
    </BusinessWorkspaceGate>
  );
}
