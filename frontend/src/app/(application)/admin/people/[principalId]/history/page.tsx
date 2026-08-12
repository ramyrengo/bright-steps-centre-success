import { PersonHistoryWorkspace } from "@/components/people-access-workspaces";

export default async function PersonHistoryPage({
  params,
}: Readonly<{ params: Promise<{ principalId: string }> }>) {
  const { principalId } = await params;
  return <PersonHistoryWorkspace principalId={principalId} />;
}
