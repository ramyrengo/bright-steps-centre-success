import { CentreReviewWorkspace } from "@/components/centre-review-workspace";

export default async function CentreReviewPage({
  params,
}: Readonly<{ params: Promise<{ auditId: string }> }>) {
  const { auditId } = await params;
  return <CentreReviewWorkspace auditId={auditId} />;
}
