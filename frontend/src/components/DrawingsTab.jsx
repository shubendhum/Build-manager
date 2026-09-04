import { PlannerTab } from "@/components/PlannerTab";
import { DocumentsTab } from "@/components/DocumentsTab";

/**
 * Drawings and everything else filed against the job, with the planner that
 * reads them sitting directly above. They were two screens, and the planner
 * asked you to upload a second copy of a drawing that was already here.
 */
export const DrawingsTab = ({ project, onChanged }) => (
  <div data-testid="drawings-tab">
    <PlannerTab project={project} onChanged={onChanged} />
    <div className="mt-8 pt-8 border-t border-slate-800">
      <DocumentsTab projectId={project.id} />
    </div>
  </div>
);
