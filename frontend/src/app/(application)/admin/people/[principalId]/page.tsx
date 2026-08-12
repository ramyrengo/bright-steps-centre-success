import { PersonWorkspace } from "@/components/people-access-workspaces";

export default async function PersonPage({
  params,
}: Readonly<{ params: Promise<{ principalId: string }> }>) {
  const { principalId } = await params;
  return <PersonWorkspace principalId={principalId} />;
}
