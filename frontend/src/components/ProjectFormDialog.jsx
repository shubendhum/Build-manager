import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/DatePicker";
import api, { formatApiErrorDetail } from "@/lib/api";
import { PROJECT_TYPES, PROJECT_STATUSES } from "@/lib/projectUtils";

const EMPTY = {
  name: "", client_name: "", client_contact: "", site_street: "", site_suburb: "", site_postcode: "",
  builder_name: "", builder_registration: "", dbi_policy_number: "", dbi_expiry: "",
  contract_value: "", start_date: "", target_completion: "", project_type: "new-build", status: "planning", notes: "",
};

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1.5 ${className}`}>
    <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">{label}</Label>
    {children}
  </div>
);

export const ProjectFormDialog = ({ open, onOpenChange, project, onSaved }) => {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(project);

  useEffect(() => {
    if (open) {
      setForm(project ? { ...EMPTY, ...project, contract_value: project.contract_value ?? "", dbi_expiry: project.dbi_expiry || "", start_date: project.start_date || "", target_completion: project.target_completion || "" } : EMPTY);
    }
  }, [open, project]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setVal = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const fieldCls = "bg-slate-800/50 border-slate-600";

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        contract_value: parseFloat(form.contract_value) || 0,
        dbi_expiry: form.dbi_expiry || null,
        start_date: form.start_date || null,
        target_completion: form.target_completion || null,
      };
      delete payload.id; delete payload.progress; delete payload.stage_progress;
      delete payload.created_at; delete payload.updated_at; delete payload.is_seed;
      const { data } = isEdit
        ? await api.put(`/projects/${project.id}`, payload)
        : await api.post("/projects", payload);
      if (isEdit) {
        toast.success("Project updated");
      } else {
        toast.success("Project created — Victorian roadmap generated", {
          duration: 8000,
          action: {
            label: "Plan with AI →",
            onClick: () => navigate(`/projects/${data.id}?tab=planner`),
          },
        });
      }
      onOpenChange(false);
      onSaved?.(data);
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Failed to save project.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-card border-slate-700" data-testid="project-form-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl font-bold text-slate-100">
            {isEdit ? "Edit Project" : "New Project"}
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">
            {isEdit ? "Update project details." : "Creating a project auto-generates its Victorian compliance roadmap."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
          <Field label="Project name *" className="sm:col-span-2">
            <Input data-testid="project-form-name" required className={fieldCls} value={form.name} onChange={set("name")} placeholder="Residence – Suburb" />
          </Field>
          <Field label="Project type">
            <Select value={form.project_type} onValueChange={setVal("project_type")}>
              <SelectTrigger data-testid="project-form-type" className={fieldCls}><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROJECT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={setVal("status")}>
              <SelectTrigger data-testid="project-form-status" className={fieldCls}><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Client name *">
            <Input data-testid="project-form-client-name" required className={fieldCls} value={form.client_name} onChange={set("client_name")} />
          </Field>
          <Field label="Client contact">
            <Input data-testid="project-form-client-contact" className={fieldCls} value={form.client_contact} onChange={set("client_contact")} placeholder="Phone · email" />
          </Field>
          <Field label="Site street" className="sm:col-span-2">
            <Input data-testid="project-form-street" className={fieldCls} value={form.site_street} onChange={set("site_street")} />
          </Field>
          <Field label="Suburb *">
            <Input data-testid="project-form-suburb" required className={fieldCls} value={form.site_suburb} onChange={set("site_suburb")} />
          </Field>
          <Field label="VIC postcode *">
            <Input data-testid="project-form-postcode" required className={fieldCls} value={form.site_postcode} onChange={set("site_postcode")} placeholder="3350" maxLength={4} />
          </Field>
          <Field label="Builder name">
            <Input data-testid="project-form-builder-name" className={fieldCls} value={form.builder_name} onChange={set("builder_name")} />
          </Field>
          <Field label="Registration number">
            <Input data-testid="project-form-builder-registration" className={fieldCls} value={form.builder_registration} onChange={set("builder_registration")} placeholder="DB-U 12345" />
          </Field>
          <Field label="DBI policy number">
            <Input data-testid="project-form-dbi-policy" className={fieldCls} value={form.dbi_policy_number} onChange={set("dbi_policy_number")} />
          </Field>
          <Field label="DBI expiry">
            <DatePicker value={form.dbi_expiry} onChange={setVal("dbi_expiry")} testId="project-form-dbi-expiry" placeholder="Policy expiry" />
          </Field>
          <Field label="Contract value (AUD)">
            <Input data-testid="project-form-contract-value" type="number" min="0" step="1000" className={fieldCls} value={form.contract_value} onChange={set("contract_value")} placeholder="620000" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start date">
              <DatePicker value={form.start_date} onChange={setVal("start_date")} testId="project-form-start-date" />
            </Field>
            <Field label="Target completion">
              <DatePicker value={form.target_completion} onChange={setVal("target_completion")} testId="project-form-target-completion" />
            </Field>
          </div>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea data-testid="project-form-notes" className={`${fieldCls} min-h-[70px]`} value={form.notes} onChange={set("notes")} />
          </Field>
          <div className="sm:col-span-2 flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" data-testid="project-form-cancel" onClick={() => onOpenChange(false)}
              className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-800">
              Cancel
            </Button>
            <Button type="submit" data-testid="project-form-save-button" disabled={busy}
              className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : isEdit ? "Save Changes" : "Create Project"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
