import { BusinessWorkspaceGate } from "@/components/app-shell";
import { TemplateLibraryWorkspace } from "@/components/template-library";

export default function TemplateLibraryPage() {
  return (
    <BusinessWorkspaceGate>
      <TemplateLibraryWorkspace />
    </BusinessWorkspaceGate>
  );
}
