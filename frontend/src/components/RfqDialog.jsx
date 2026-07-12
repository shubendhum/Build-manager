import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, Send, Copy, Mail, CheckCircle2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/DatePicker";
import api, { formatApiErrorDetail } from "@/lib/api";
import { ROADMAP_STAGES, formatDate } from "@/lib/projectUtils";

const EMPTY = { trade_id: "", stage_key: "lockup", scope: "", due_date: "" };

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1.5 ${className}`}>
    <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">{label}</Label>
    {children}
  </div>
);

export const rfqPublicUrl = (rfq) => `${window.location.origin}/quote/${rfq.token}`;

export const copyRfqLink = async (rfq) => {
  try {
    await navigator.clipboard.writeText(rfqPublicUrl(rfq));
    toast.success("Quote link copied to clipboard");
  } catch {
    toast.error("Could not copy — copy the link manually.");
  }
};

export const RfqDialog = ({ open, onOpenChange, projectId, trades, onSaved }) => {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const fieldCls = "bg-slate-800/50 border-slate-600";

  useEffect(() => {
    if (open) { setForm(EMPTY); setCreated(null); }
  }, [open]);

  const setVal = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.trade_id) { toast.error("Select the trade you want a quote from."); return; }
    setBusy(true);
    try {
      const { data } = await api.post(`/projects/${projectId}/rfqs`, {
        trade_id: form.trade_id,
        stage_key: form.stage_key,
        scope: form.scope,
        due_date: form.due_date || null,
      });
      setCreated(data);
      onSaved?.();
      toast.success("Quote request created — share the link with the trade.");
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Failed to create quote request.");
    } finally {
      setBusy(false);
    }
  };

  const mailtoHref = created
    ? `mailto:${created.trade_email || ""}?subject=${encodeURIComponent(`Quote request — ${created.scope.split("\n")[0].slice(0, 60)}`)}&body=${encodeURIComponent(
        `Hi ${created.trade_name || ""},\n\nPlease provide a quote for the following scope of works:\n\n${created.scope}\n\n` +
        (created.due_date ? `Quote due by: ${formatDate(created.due_date)}\n\n` : "") +
        `Submit your quote online here:\n${rfqPublicUrl(created)}\n\nThanks`
      )}`
    : "#";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-slate-700" data-testid="rfq-dialog">
        {!created ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-heading text-xl font-bold text-slate-100">Request a Quote</DialogTitle>
              <DialogDescription className="text-slate-400 text-sm">
                Creates a secure public link the trade can open on their phone to submit a quote — no login needed.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4 mt-2">
              <Field label="Trade *">
                <Select value={form.trade_id} onValueChange={setVal("trade_id")}>
                  <SelectTrigger data-testid="rfq-trade-select" className={fieldCls}>
                    <SelectValue placeholder="Select a trade" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-slate-700">
                    {trades.map((t) => <SelectItem key={t.id} value={t.id}>{t.business_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Stage">
                <Select value={form.stage_key} onValueChange={setVal("stage_key")}>
                  <SelectTrigger data-testid="rfq-stage-select" className={fieldCls}><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-slate-700">
                    {ROADMAP_STAGES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Scope of works *">
                <Textarea data-testid="rfq-scope-input" required className={`${fieldCls} min-h-[110px]`}
                  value={form.scope} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
                  placeholder={"e.g. Supply and install roof plumbing to new dwelling —\ngutters, downpipes and flashings per drawings."} />
              </Field>
              <Field label="Quote due by">
                <DatePicker value={form.due_date} onChange={setVal("due_date")} testId="rfq-due-date" placeholder="Optional deadline" />
              </Field>
              <div className="flex justify-end gap-3 pt-1">
                <Button type="button" variant="outline" data-testid="rfq-cancel" onClick={() => onOpenChange(false)}
                  className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-800">
                  Cancel
                </Button>
                <Button type="submit" data-testid="rfq-create-button" disabled={busy}
                  className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <><Send className="h-4 w-4" aria-hidden="true" /> Create Request</>}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-heading text-xl font-bold text-slate-100 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-hidden="true" /> Request Created
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-sm">
                Send this link to {created.trade_name || "the trade"} — they can submit their quote directly from any device.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="rounded-md border border-slate-700 bg-slate-800/50 px-3 py-2.5 flex items-center gap-2">
                <Link2 className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
                <p className="text-xs text-slate-200 truncate flex-1" data-testid="rfq-public-url">{rfqPublicUrl(created)}</p>
                <button type="button" data-testid="rfq-copy-link" onClick={() => copyRfqLink(created)}
                  className="shrink-0 inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors duration-200">
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
                </button>
              </div>
              <div className="flex flex-wrap justify-end gap-3">
                <a href={mailtoHref} data-testid="rfq-email-link"
                  className="inline-flex items-center gap-2 rounded-md border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:text-amber-400 hover:border-amber-500/50 transition-colors duration-200">
                  <Mail className="h-4 w-4" aria-hidden="true" /> Email {created.trade_name || "trade"}
                </a>
                <Button data-testid="rfq-done-button" onClick={() => onOpenChange(false)}
                  className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
                  Done
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
