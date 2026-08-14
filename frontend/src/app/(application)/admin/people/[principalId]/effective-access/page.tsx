import { PersonEffectiveAccessWorkspace } from "@/components/people-access-workspaces";

export default async function PersonEffectiveAccessPage({
  params,
}: Readonly<{ params: Promise<{ principalId: string }> }>) {
  const { principalId } = await params;
  return <PersonEffectiveAccessWorkspace principalId={principalId} />;
}
