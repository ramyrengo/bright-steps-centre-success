import { BusinessWorkspaceGate } from "@/components/app-shell";
import { TemplatePreview } from "@/components/template-preview";

/**
 * The phone preview route.
 *
 * A preview is a representation, not an operation: opening this route publishes
 * nothing, assigns no centre, creates no occurrence and records no completion.
 */
export default async function TemplatePreviewPage({
  params,
}: Readonly<{ params: Promise<{ templateId: string }> }>) {
  const { templateId } = await params;
  return (
    <BusinessWorkspaceGate>
      <TemplatePreview templateId={templateId} />
    </BusinessWorkspaceGate>
  );
}
