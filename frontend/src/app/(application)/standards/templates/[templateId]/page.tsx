import { BusinessWorkspaceGate } from "@/components/app-shell";
import { TemplateEditor } from "@/components/template-editor";

/**
 * The template route.
 *
 * One route serves every lifecycle state. Whether it renders an editor or an
 * immutable record is decided by what the version turns out to be, not by which
 * link was followed — routing an Area Manager to an edit-only destination for a
 * published version would land them on a screen that cannot do what its address
 * promised.
 */
export default async function TemplatePage({
  params,
}: Readonly<{ params: Promise<{ templateId: string }> }>) {
  const { templateId } = await params;
  return (
    <BusinessWorkspaceGate>
      <TemplateEditor templateId={templateId} />
    </BusinessWorkspaceGate>
  );
}
