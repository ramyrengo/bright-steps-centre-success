import { AppShell, BusinessWorkspaceGate } from "@/components/app-shell";
import { CentreStandardsCheck } from "@/components/centre-standards-check";

/**
 * A focused single-task screen. `links={[]}` removes the workspace navigation
 * entirely so nothing competes with completing the check.
 */
export default async function CentreStandardsCheckPage({
  params,
}: Readonly<{ params: Promise<{ occurrenceId: string }> }>) {
  const { occurrenceId } = await params;
  return (
    <BusinessWorkspaceGate>
      <AppShell links={[]}>
        <CentreStandardsCheck occurrenceId={occurrenceId} />
      </AppShell>
    </BusinessWorkspaceGate>
  );
}
