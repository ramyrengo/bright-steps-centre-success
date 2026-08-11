import { QuarterlyAuditWorkspace } from "@/components/quarterly-audit-workspace";

export default async function QuarterlyAuditPage({
  params,
}: Readonly<{
  params: Promise<{ centreId: string; auditId: string }>;
}>) {
  const { auditId } = await params;
  return <QuarterlyAuditWorkspace auditId={auditId} />;
}
