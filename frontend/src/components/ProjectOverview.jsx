import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ProjectFormDialog } from "@/components/ProjectFormDialog";
import api from "@/lib/api";
import { formatAUD, formatDate, typeLabel } from "@/lib/projectUtils";

const Item = ({ label, value, testId }) => (
  <div>
    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">{label}</p>
    <p className="text-sm text-slate-200" data-testid={testId}>{value || "—"}</p>
  </div>
);

export const ProjectOverview = ({ project, onChanged }) => {
  const [editOpen, setEditOpen] = useState(false);
  const navigate = useNavigate();

  const handleDelete = async () => {
    try {
      await api.delete(`/projects/${project.id}`);
      toast.success("Project deleted");
      navigate("/projects");
    } catch (e) {
      toast.error("Failed to delete project.");
    }
  };

  return (
    <div data-testid="project-overview">
      <div className="flex justify-end gap-3 mb-6">
        <Button variant="outline" data-testid="edit-project-button" onClick={() => setEditOpen(true)}
          className="border-slate-600 text-slate-300 hover:text-amber-400 hover:border-amber-500/50 hover:bg-transparent">
          <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" data-testid="delete-project-button"
              className="border-slate-600 text-slate-300 hover:text-red-400 hover:border-red-500/50 hover:bg-transparent">
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="bg-card border-slate-700">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-slate-100">Delete this project?</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                This permanently removes the project and its roadmap tasks. Photo analyses are kept but unlinked.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="delete-cancel" className="border-slate-600 text-slate-300">Cancel</AlertDialogCancel>
              <AlertDialogAction data-testid="delete-confirm" onClick={handleDelete}
                className="bg-red-600 text-white hover:bg-red-500">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <section className="rounded-md border border-slate-700 bg-card p-6 space-y-4">
          <h3 className="text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold">Client</h3>
          <Item label="Client name" value={project.client_name} testId="overview-client-name" />
          <Item label="Contact" value={project.client_contact} testId="overview-client-contact" />
          <Item label="Project type" value={typeLabel(project.project_type)} testId="overview-project-type" />
          <Item label="Contract value" value={formatAUD(project.contract_value)} testId="overview-contract-value" />
        </section>
        <section className="rounded-md border border-slate-700 bg-card p-6 space-y-4">
          <h3 className="text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold">Builder &amp; Compliance</h3>
          <Item label="Builder" value={project.builder_name} testId="overview-builder-name" />
          <Item label="Registration" value={project.builder_registration} testId="overview-builder-registration" />
          <Item label="DBI policy" value={project.dbi_policy_number} testId="overview-dbi-policy" />
          <Item label="DBI expiry" value={formatDate(project.dbi_expiry)} testId="overview-dbi-expiry" />
        </section>
        <section className="rounded-md border border-slate-700 bg-card p-6 space-y-4">
          <h3 className="text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold">Timeline &amp; Notes</h3>
          <Item label="Start date" value={formatDate(project.start_date)} testId="overview-start-date" />
          <Item label="Target completion" value={formatDate(project.target_completion)} testId="overview-target-completion" />
          <Item label="Notes" value={project.notes} testId="overview-notes" />
        </section>
      </div>

      <ProjectFormDialog open={editOpen} onOpenChange={setEditOpen} project={project} onSaved={onChanged} />
    </div>
  );
};
