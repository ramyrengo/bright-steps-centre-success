import { InvitationReviewWorkspace } from "@/components/people-access-workspaces";

export default async function InvitationPage({
  params,
}: Readonly<{ params: Promise<{ invitationId: string }> }>) {
  const { invitationId } = await params;
  return <InvitationReviewWorkspace invitationId={invitationId} />;
}
