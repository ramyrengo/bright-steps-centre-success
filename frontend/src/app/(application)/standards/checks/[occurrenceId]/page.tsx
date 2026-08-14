import { BusinessWorkspaceGate } from "@/components/app-shell";
import { ConnectedCentreStandardsCheck } from "@/components/centre-standards-connected";

/**
 * The occurrence route. The shell belongs to the component rather than this
 * page, because whether the screen is a focused single task or a read-only
 * record is only known once the occurrence has loaded.
 */
export default async function CentreStandardsCheckPage({
  params,
}: Readonly<{ params: Promise<{ occurrenceId: string }> }>) {
  const { occurrenceId } = await params;
  return (
    <BusinessWorkspaceGate>
      <ConnectedCentreStandardsCheck occurrenceId={occurrenceId} />
    </BusinessWorkspaceGate>
  );
}
