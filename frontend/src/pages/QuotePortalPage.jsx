import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { HardHat, MapPin, CalendarClock, Loader2, CheckCircle2, Paperclip, X, AlertTriangle, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import api, { formatApiErrorDetail } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/projectUtils";
import { autoGst } from "@/lib/tradeUtils";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

const formatFileSize = (bytes) => {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1.5 ${className}`}>
    <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">{label}</Label>
    {children}
  </div>
);

const Shell = ({ children }) => (
  <div className="min-h-screen bg-background blueprint-grid">
    <header className="sticky top-0 z-10 backdrop-blur-xl bg-slate-900/85 border-b border-slate-800 px-4 py-3 flex items-center gap-2">
      <div className="h-8 w-8 rounded-md bg-amber-500 flex items-center justify-center">
        <HardHat className="h-4 w-4 text-slate-950" aria-hidden="true" />
      </div>
      <p className="font-heading text-sm font-bold text-slate-100">BuildManager <span className="text-amber-400">VIC</span></p>
      <span className="ml-auto text-[10px] uppercase tracking-[0.2em] text-slate-500">Trade quote portal</span>
    </header>
    <main className="max-w-xl mx-auto px-4 py-8">{children}</main>
  </div>
);

export default function QuotePortalPage() {
  const { token } = useParams();
  const [rfq, setRfq] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({
    amount_ex_gst: "", gst_amount: "", inclusions: "", exclusions: "", lead_time: "",
    contact_name: "", contact_phone: "", contact_email: "",
  });
  const fieldCls = "bg-slate-800/50 border-slate-600";

  useEffect(() => {
    api.get(`/public/rfqs/${token}`)
      .then(({ data }) => {
        setRfq(data);
        if (data.status === "submitted") setSubmitted(true);
      })
      .catch((e) => {
        setLoadError(formatApiErrorDetail(e.response?.data?.detail) ||
          "This quote request could not be found.");
      });
  }, [token]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const onExChange = (e) => {
    const ex = e.target.value;
    setForm((f) => ({ ...f, amount_ex_gst: ex, gst_amount: String(autoGst(ex)) }));
  };
  const total = (parseFloat(form.amount_ex_gst) || 0) + (parseFloat(form.gst_amount) || 0);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("amount_ex_gst", parseFloat(form.amount_ex_gst) || 0);
      fd.append("gst_amount", parseFloat(form.gst_amount) || 0);
      fd.append("inclusions", form.inclusions);
      fd.append("exclusions", form.exclusions);
      fd.append("lead_time", form.lead_time);
      fd.append("contact_name", form.contact_name);
      fd.append("contact_phone", form.contact_phone);
      fd.append("contact_email", form.contact_email);
      if (file) fd.append("attachment", file);
      await api.post(`/public/rfqs/${token}/submit`, fd, { timeout: 60000 });
      setSubmitted(true);
      window.scrollTo({ top: 0 });
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Could not send your quote — please try again.");
      if (err.response?.status === 409) setSubmitted(true);
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <Shell>
        <div className="rounded-md border border-slate-700 bg-card p-8 text-center" data-testid="portal-error">
          <AlertTriangle className="h-8 w-8 text-amber-400 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-slate-300">{loadError}</p>
          <p className="text-xs text-slate-500 mt-2">If you think this is a mistake, contact the builder who sent you the link.</p>
        </div>
      </Shell>
    );
  }
  if (!rfq) {
    return (
      <Shell>
        <div className="flex items-center gap-3 text-slate-400 justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-amber-400" aria-hidden="true" />
          <p className="text-sm">Loading quote request…</p>
        </div>
      </Shell>
    );
  }
  if (submitted) {
    return (
      <Shell>
        <div className="rounded-md border border-emerald-600/50 bg-card p-8 text-center" data-testid="portal-success">
          <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-4" aria-hidden="true" />
          <h1 className="font-heading text-xl font-bold text-slate-100 mb-2">Quote submitted</h1>
          <p className="text-sm text-slate-400">
            Thanks — your quote for <span className="text-slate-200">{rfq.project_name}</span> has been sent to{" "}
            {rfq.builder_name}. They'll be in touch if it's accepted.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div data-testid="quote-portal-page">
        <p className="text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold mb-2">Quote request from {rfq.builder_name}</p>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-slate-100 mb-1">{rfq.project_name}</h1>
        <p className="flex items-start gap-1.5 text-base text-slate-200 mb-1" data-testid="portal-site-address">
          <MapPin className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
          {rfq.site_address}
        </p>
        {rfq.due_date && (
          <p className="flex items-center gap-1.5 text-sm text-slate-400 mb-4">
            <CalendarClock className="h-4 w-4 text-amber-400" aria-hidden="true" /> Quote due by {formatDate(rfq.due_date)}
          </p>
        )}

        <div className="rounded-md border border-slate-700 bg-card p-4 mb-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1.5">
            {rfq.package_title ? `${rfq.package_title} — ` : ""}Scope of works — {rfq.trade_name}
          </p>
          <p className="text-sm text-slate-200 whitespace-pre-wrap" data-testid="portal-scope">{rfq.scope}</p>
        </div>

        {rfq.documents?.length > 0 && (
          <div className="rounded-md border border-slate-700 bg-card p-4 mb-6" data-testid="portal-documents">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2.5">
              Drawings &amp; documents ({rfq.documents.length})
            </p>
            <div className="space-y-2">
              {rfq.documents.map((doc) => (
                <a key={doc.id} href={`${BACKEND_URL}/api/public/rfqs/${token}/documents/${doc.id}`}
                  target="_blank" rel="noopener noreferrer" data-testid={`portal-document-${doc.id}`}
                  className="flex items-center gap-3 rounded-md border border-slate-700 bg-slate-800/40 px-3 py-2.5 hover:border-amber-500/50 transition-colors duration-200">
                  <FileText className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-slate-200 truncate">{doc.title}</span>
                    <span className="block text-[11px] text-slate-500 truncate">
                      {doc.filename}{doc.file_size ? ` · ${formatFileSize(doc.file_size)}` : ""}
                    </span>
                  </span>
                  <Download className="h-4 w-4 text-slate-500 shrink-0" aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <h2 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Your Quote</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount ex GST (AUD) *">
              <Input data-testid="portal-amount-input" required type="number" min="0" step="0.01" inputMode="decimal"
                className={fieldCls} value={form.amount_ex_gst} onChange={onExChange} placeholder="0.00" />
            </Field>
            <Field label="GST">
              <Input data-testid="portal-gst-input" type="number" min="0" step="0.01" inputMode="decimal"
                className={fieldCls} value={form.gst_amount} onChange={set("gst_amount")} placeholder="0.00" />
            </Field>
          </div>
          <p className="text-sm text-slate-400">Total inc GST: <span className="font-heading font-bold text-amber-400">{formatMoney(total)}</span></p>
          <Field label="Inclusions">
            <Textarea data-testid="portal-inclusions-input" className={`${fieldCls} min-h-[80px]`}
              value={form.inclusions} onChange={set("inclusions")} placeholder="What your price covers" />
          </Field>
          <Field label="Exclusions">
            <Textarea data-testid="portal-exclusions-input" className={`${fieldCls} min-h-[60px]`}
              value={form.exclusions} onChange={set("exclusions")} placeholder="Anything not covered" />
          </Field>
          <Field label="Lead time">
            <Input data-testid="portal-leadtime-input" className={fieldCls} value={form.lead_time}
              onChange={set("lead_time")} placeholder="e.g. 2 weeks from confirmation" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Your name *">
              <Input data-testid="portal-contact-name" required className={fieldCls} value={form.contact_name} onChange={set("contact_name")} />
            </Field>
            <Field label="Phone">
              <Input data-testid="portal-contact-phone" type="tel" className={fieldCls} value={form.contact_phone} onChange={set("contact_phone")} />
            </Field>
            <Field label="Email">
              <Input data-testid="portal-contact-email" type="email" className={fieldCls} value={form.contact_email} onChange={set("contact_email")} />
            </Field>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-[0.15em] text-slate-400 block mb-1.5">Attach quote (optional)</Label>
            {file ? (
              <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800/50 px-3 py-2">
                <Paperclip className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
                <span className="text-xs text-slate-200 truncate flex-1">{file.name}</span>
                <button type="button" data-testid="portal-attachment-clear" onClick={() => setFile(null)}
                  className="text-slate-400 hover:text-red-400"><X className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            ) : (
              <label className="flex items-center gap-2 rounded-md border border-dashed border-slate-600 bg-slate-800/30 px-3 py-2.5 cursor-pointer hover:border-amber-500 transition-colors duration-200">
                <Paperclip className="h-4 w-4 text-amber-400" aria-hidden="true" />
                <span className="text-xs text-slate-400">PDF, JPEG, PNG or WEBP up to 10 MB</span>
                <input data-testid="portal-attachment-input" type="file" className="hidden"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && f.size > 10 * 1024 * 1024) { toast.error("Attachment too large — maximum 10 MB."); return; }
                    setFile(f || null);
                  }} />
              </label>
            )}
          </div>
          <Button type="submit" data-testid="portal-submit-button" disabled={busy}
            className="w-full bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200 h-11">
            {busy ? (<><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Submitting…</>) : "Submit Quote"}
          </Button>
          <p className="text-[11px] text-slate-500 text-center pb-6">
            Submitted quotes go straight to {rfq.builder_name}'s BuildManager project record.
          </p>
        </form>
      </div>
    </Shell>
  );
}
