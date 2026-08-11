import { VerificationWorkspace } from "@/components/verification-workspace";

export default async function VerificationPage({
  params,
}: Readonly<{ params: Promise<{ actionId: string }> }>) {
  const { actionId } = await params;
  return <VerificationWorkspace actionId={actionId} />;
}
