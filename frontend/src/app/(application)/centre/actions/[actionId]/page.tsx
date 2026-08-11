import { CentreActionWorkspace } from "@/components/centre-actions-workspace";

export default async function CentreActionPage({
  params,
}: Readonly<{ params: Promise<{ actionId: string }> }>) {
  const { actionId } = await params;
  return <CentreActionWorkspace actionId={actionId} />;
}
