import { PersonAccessWorkspace } from "@/components/people-access-workspaces";

export default async function PersonAccessPage({
  params,
}: Readonly<{ params: Promise<{ principalId: string }> }>) {
  const { principalId } = await params;
  return <PersonAccessWorkspace principalId={principalId} />;
}
