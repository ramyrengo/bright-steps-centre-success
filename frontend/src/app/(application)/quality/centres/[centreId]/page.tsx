import { BusinessWorkspaceGate } from "@/components/app-shell";
import { QualityCentreDetail } from "@/components/quality-centre-detail";

export default async function QualityCentrePage({
  params,
}: Readonly<{ params: Promise<{ centreId: string }> }>) {
  const { centreId } = await params;
  return (
    <BusinessWorkspaceGate>
      <QualityCentreDetail centreId={centreId} />
    </BusinessWorkspaceGate>
  );
}
