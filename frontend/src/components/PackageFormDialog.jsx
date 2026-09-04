import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import api, { formatApiErrorDetail } from "@/lib/api";
import { ROADMAP_STAGES } from "@/lib/projectUtils";
import { TRADE_TYPES, PACKAGE_STATUSES } from "@/lib/tradeUtils";

const EMPTY = { title: "", trade_type: "other", stage_key: "lockup", scope: "", status: "draft" };

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1.5 ${className}`}>
    <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">{label}</Label>
    {children}
  </div>
);

export const PackageFormDialog = ({ open, onOpenChange, projectId, pkg, onSaved }) => {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const fieldCls = "bg-slate-800/50 border-slate-600";
  const editing = Boolean(pkg);

  useEffect(() => {
    if (!open) return;
    setForm(pkg
      ? { title: pkg.title, trade_type: pkg.trade_type, stage_key: pkg.stage_key, scope: pkg.scope || "", status: pkg.status }
      : EMPTY);
  }, [open, pkg]);

  const setVal = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error("Give the package a title."); return; }
    setBusy(true);
    try {
      if (editing) {
        await api.put(`/packages/${pkg.id}`, form);
        toast.success("Package updated");
      } else {
        await api.post(`/projects/${projectId}/packages`, form);
        toast.success("Package created");
      }
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Could not save that trade package.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-slate-700" data-testid="package-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl font-bold text-slate-100">
            {editing ? "Edit Work Package" : "New Work Package"}
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">
            A package is one scope you can send out for quotes and later award — quotes, requests and estimate
            lines all group under it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 mt-2">
          <Field label="Title *">
            <Input data-testid="package-title-input" required className={fieldCls} value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Plumbing — rough-in & fit-off" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Trade type">
              <Select value={form.trade_type} onValueChange={setVal("trade_type")}>
                <SelectTrigger data-testid="package-trade-type" className={fieldCls}><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-slate-700">
                  {TRADE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Stage">
              <Select value={form.stage_key} onValueChange={setVal("stage_key")}>
                <SelectTrigger data-testid="package-stage" className={fieldCls}><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-slate-700">
                  {ROADMAP_STAGES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {editing && (
            <Field label="Status">
              <Select value={form.status} onValueChange={setVal("status")}>
                <SelectTrigger data-testid="package-status" className={fieldCls}><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-slate-700">
                  {PACKAGE_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Scope of works">
            <Textarea data-testid="package-scope-input" className={`${fieldCls} min-h-[110px]`} value={form.scope}
              onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
              placeholder={"This is the text trades receive when you request a quote.\ne.g. Supply and install roof plumbing — gutters, downpipes and flashings per drawings."} />
          </Field>
          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" data-testid="package-cancel" onClick={() => onOpenChange(false)}
              className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-800">
              Cancel
            </Button>
            <Button type="submit" data-testid="package-save-button" disabled={busy}
              className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : editing ? "Save Changes" : "Create Package"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
