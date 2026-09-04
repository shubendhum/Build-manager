import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  Loader2, Send, ArrowLeft, ArrowRight, CheckCircle2, AlertTriangle, FileText,
  Mail, MessageSquare, Copy, Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DatePicker } from "@/components/DatePicker";
import api, { formatApiErrorDetail } from "@/lib/api";
import { formatDate } from "@/lib/projectUtils";
import { tradeTypeLabel, tradeWarningLabel } from "@/lib/tradeUtils";

export const rfqPublicUrl = (token) => `${window.location.origin}/quote/${token}`;

export const copyRfqLink = async (token) => {
  try {
    await navigator.clipboard.writeText(rfqPublicUrl(token));
    toast.success("Quote link copied to clipboard");
  } catch {
    toast.error("Could not copy — copy the link manually.");
  }
};

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1.5 ${className}`}>
    <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">{label}</Label>
    {children}
  </div>
);

const ChannelToggle = ({ active, onClick, icon: Icon, label, testId }) => (
  <button type="button" data-testid={testId} onClick={onClick} aria-pressed={active}
    className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors duration-200 ${
      active ? "border-amber-500 bg-amber-500/10 text-amber-400" : "border-slate-600 text-slate-400 hover:text-slate-200"
    }`}>
    <Icon className="h-4 w-4" aria-hidden="true" /> {label}
  </button>
);

export const SendRfqDialog = ({ open, onOpenChange, projectId, pkg, trades, documents, onSaved }) => {
  // Opened from the Packages tab with a package ({id, scope}) and from the Work
  // board with a board row ({package_id, no scope}). Normalise both here so the
  // caller's shape can never drop a required field on the floor again.
  const packageId = pkg?.id ?? pkg?.package_id ?? null;
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState([]);
  const [emails, setEmails] = useState({});   // trade_id -> email captured inline
  const [phones, setPhones] = useState({});
  const [scope, setScope] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [docIds, setDocIds] = useState([]);
  const [channels, setChannels] = useState(["email"]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const fieldCls = "bg-slate-800/50 border-slate-600";

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSelected([]);
    setEmails({});
    setPhones({});
    setScope(pkg?.scope ?? "");
    setDueDate("");
    setDocIds(documents.filter((d) => d.category === "drawings").map((d) => d.id));
    setChannels(["email"]);
    setResults(null);
  }, [open, pkg, documents]);

  // Matching trades first — but never hide the rest, since the right person for
  // a package isn't always filed under its trade type.
  const sortedTrades = useMemo(() => {
    const match = (t) => (pkg?.trade_type && t.trade_type === pkg.trade_type ? 0 : 1);
    return [...trades].sort((a, b) => match(a) - match(b) || a.business_name.localeCompare(b.business_name));
  }, [trades, pkg]);

  const toggleTrade = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const toggleChannel = (c) =>
    setChannels((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  const tradeById = (id) => trades.find((t) => t.id === id);
  const emailFor = (id) => emails[id] ?? tradeById(id)?.email ?? "";
  const phoneFor = (id) => phones[id] ?? tradeById(id)?.phone ?? "";

  const missingContact = selected.filter((id) => {
    const needEmail = channels.includes("email") && !emailFor(id).trim();
    const needPhone = channels.includes("sms") && !phoneFor(id).trim();
    return needEmail || needPhone;
  });

  const saveCapturedContacts = async () => {
    const updates = selected
      .map((id) => {
        const patch = {};
        if (emails[id] !== undefined && emails[id] !== tradeById(id)?.email) patch.email = emails[id].trim();
        if (phones[id] !== undefined && phones[id] !== tradeById(id)?.phone) patch.phone = phones[id].trim();
        return Object.keys(patch).length ? api.put(`/trades/${id}`, patch) : null;
      })
      .filter(Boolean);
    if (updates.length) await Promise.all(updates);
  };

  const send = async () => {
    if (!channels.length) { toast.error("Pick at least one way to send this."); return; }
    if (!packageId) { toast.error("This package could not be identified — reload and try again."); return; }
    if (!scope.trim()) { toast.error("Add a scope of works before sending."); return; }
    setBusy(true);
    try {
      await saveCapturedContacts();
      const { data: rfq } = await api.post(`/projects/${projectId}/rfqs`, {
        package_id: packageId,
        trade_ids: selected,
        scope,
        stage_key: pkg?.stage_key ?? null,
        due_date: dueDate || null,
        document_ids: docIds,
      });
      const { data: outcome } = await api.post(`/rfqs/${rfq.id}/send`, { channels });
      setResults({ ...outcome, rfq });
      setStep(3);
      onSaved?.();
      if (outcome.failed === 0) toast.success(`Sent to ${outcome.sent} trade${outcome.sent === 1 ? "" : "s"}`);
      else toast.warning(`${outcome.sent} sent, ${outcome.failed} failed — see the details.`);
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Could not send that quote request.");
    } finally {
      setBusy(false);
    }
  };

  if (!pkg) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card border-slate-700 max-h-[90vh] overflow-y-auto" data-testid="send-rfq-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl font-bold text-slate-100">
            {step === 3 ? "Quote Request Sent" : `Request Quotes — ${pkg.title}`}
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">
            {step === 1 && "Pick every trade you want to price this package. Each one gets their own private link."}
            {step === 2 && "Check the scope, attach the drawings they need to price from, and choose how it goes out."}
            {step === 3 && "Each trade received a link unique to them. Their quotes land straight on this job."}
          </DialogDescription>
        </DialogHeader>

        {/* ---------- Step 1: trades ---------- */}
        {step === 1 && (
          <div className="space-y-3 mt-2">
            {trades.length === 0 && (
              <p className="text-sm text-slate-400 py-6 text-center" data-testid="send-rfq-no-trades">
                No trades in your directory yet — add some from the Trades page first.
              </p>
            )}
            <div className="rounded-md border border-slate-700 divide-y divide-slate-800 max-h-[46vh] overflow-y-auto">
              {sortedTrades.map((t) => {
                const warn = tradeWarningLabel(t);
                const isMatch = pkg.trade_type && t.trade_type === pkg.trade_type;
                return (
                  <label key={t.id} data-testid={`send-rfq-trade-${t.id}`}
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-800/40 transition-colors duration-200">
                    <Checkbox checked={selected.includes(t.id)} onCheckedChange={() => toggleTrade(t.id)}
                      data-testid={`send-rfq-check-${t.id}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-200 truncate">
                        {t.business_name}
                        {isMatch && <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-400">match</span>}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {tradeTypeLabel(t.trade_type)}
                        {t.email ? ` · ${t.email}` : " · no email on file"}
                      </p>
                    </div>
                    {warn && (
                      <span className={`inline-flex items-center gap-1 text-[11px] shrink-0 ${warn.tone}`} title="Licence or insurance">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {warn.text}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-xs text-slate-500" data-testid="send-rfq-selected-count">
                {selected.length} trade{selected.length === 1 ? "" : "s"} selected
              </p>
              <Button data-testid="send-rfq-next" disabled={selected.length === 0} onClick={() => setStep(2)}
                className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
                Next <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}

        {/* ---------- Step 2: scope, drawings, channels ---------- */}
        {step === 2 && (
          <div className="space-y-4 mt-2">
            <Field label="Scope of works *">
              <Textarea data-testid="send-rfq-scope" className={`${fieldCls} min-h-[110px]`} value={scope}
                onChange={(e) => setScope(e.target.value)}
                placeholder="What you want priced. This is what the trade reads." />
            </Field>

            <Field label="Quote due by">
              <DatePicker value={dueDate} onChange={setDueDate} testId="send-rfq-due-date" placeholder="Optional deadline" />
            </Field>

            <div>
              <Label className="text-xs uppercase tracking-[0.15em] text-slate-400 block mb-1.5">
                Drawings &amp; documents
              </Label>
              {documents.length === 0 ? (
                <p className="text-xs text-slate-500 rounded-md border border-dashed border-slate-600 px-3 py-3">
                  No documents on this project yet. Upload drawings in the Documents tab and they can ride along
                  with the request.
                </p>
              ) : (
                <div className="rounded-md border border-slate-700 divide-y divide-slate-800 max-h-40 overflow-y-auto">
                  {documents.map((d) => (
                    <label key={d.id} data-testid={`send-rfq-doc-${d.id}`}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-800/40 transition-colors duration-200">
                      <Checkbox checked={docIds.includes(d.id)}
                        onCheckedChange={() => setDocIds((s) => (s.includes(d.id) ? s.filter((x) => x !== d.id) : [...s, d.id]))} />
                      <FileText className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
                      <span className="text-xs text-slate-200 truncate flex-1">{d.title}</span>
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 shrink-0">{d.category}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs uppercase tracking-[0.15em] text-slate-400 block mb-1.5">Send by</Label>
              <div className="flex flex-wrap gap-2">
                <ChannelToggle active={channels.includes("email")} onClick={() => toggleChannel("email")}
                  icon={Mail} label="Email" testId="send-rfq-channel-email" />
                <ChannelToggle active={channels.includes("sms")} onClick={() => toggleChannel("sms")}
                  icon={MessageSquare} label="SMS" testId="send-rfq-channel-sms" />
              </div>
            </div>

            {missingContact.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-3" data-testid="send-rfq-missing-contacts">
                <p className="text-xs text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  Missing contact details — fill them in here and they'll be saved to the trade.
                </p>
                {missingContact.map((id) => (
                  <div key={id} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <p className="text-xs text-slate-300 self-center truncate">{tradeById(id)?.business_name}</p>
                    <div className="flex flex-col gap-2">
                      {channels.includes("email") && !tradeById(id)?.email && (
                        <Input data-testid={`send-rfq-email-${id}`} type="email" placeholder="Email address"
                          className={`${fieldCls} h-8 text-xs`} value={emails[id] ?? ""}
                          onChange={(e) => setEmails((s) => ({ ...s, [id]: e.target.value }))} />
                      )}
                      {channels.includes("sms") && !tradeById(id)?.phone && (
                        <Input data-testid={`send-rfq-phone-${id}`} type="tel" placeholder="Mobile number"
                          className={`${fieldCls} h-8 text-xs`} value={phones[id] ?? ""}
                          onChange={(e) => setPhones((s) => ({ ...s, [id]: e.target.value }))} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-md border border-slate-700 bg-slate-800/40 px-3 py-2.5 text-xs text-slate-400">
              Going to <span className="text-slate-200">{selected.length}</span> trade{selected.length === 1 ? "" : "s"}
              {docIds.length > 0 && <> with <span className="text-slate-200">{docIds.length}</span> document{docIds.length === 1 ? "" : "s"}</>}
              {dueDate && <> · due {formatDate(dueDate)}</>}
            </div>

            <div className="flex justify-between gap-3 pt-1">
              <Button type="button" variant="outline" data-testid="send-rfq-back" onClick={() => setStep(1)}
                className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-800">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
              </Button>
              <Button data-testid="send-rfq-send" disabled={busy || !scope.trim()} onClick={send}
                className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Sending…</>
                      : <><Send className="h-4 w-4" aria-hidden="true" /> Send Request</>}
              </Button>
            </div>
          </div>
        )}

        {/* ---------- Step 3: results ---------- */}
        {step === 3 && results && (
          <div className="space-y-4 mt-2">
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="inline-flex items-center gap-1.5 text-emerald-400" data-testid="send-rfq-result-sent">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {results.sent} sent
              </span>
              {results.failed > 0 && (
                <span className="inline-flex items-center gap-1.5 text-red-400" data-testid="send-rfq-result-failed">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {results.failed} failed
                </span>
              )}
            </div>

            <div className="rounded-md border border-slate-700 divide-y divide-slate-800">
              {results.results.map((r) => {
                const inv = results.rfq.invitations.find((i) => i.id === r.invitation_id);
                return (
                  <div key={r.invitation_id} className="px-4 py-3" data-testid={`send-rfq-result-${r.trade_id}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-slate-200 flex-1 min-w-0 truncate">{r.trade_name}</p>
                      <Badge variant="outline" className={`uppercase tracking-wider text-[10px] shrink-0 ${
                        r.ok ? "bg-emerald-600/20 text-emerald-400 border-emerald-600/40" : "bg-red-500/15 text-red-400 border-red-500/50"
                      }`}>
                        {r.ok ? r.channels.join(" + ") : "failed"}
                      </Badge>
                      {inv && (
                        <button type="button" data-testid={`send-rfq-copy-${r.trade_id}`} onClick={() => copyRfqLink(inv.token)}
                          title="Copy this trade's link"
                          className="p-1 rounded-md text-slate-500 hover:text-amber-400 transition-colors duration-200">
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {!r.ok && <p className="text-xs text-red-400 mt-1">{r.error}</p>}
                    {!r.ok && inv && (
                      <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                        <Link2 className="h-3 w-3" aria-hidden="true" />
                        Copy their link above and send it by hand instead.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-1">
              <Button data-testid="send-rfq-done" onClick={() => onOpenChange(false)}
                className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
