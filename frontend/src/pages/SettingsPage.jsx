import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Mail, CheckCircle2, AlertTriangle, Loader2, RefreshCw, Unplug, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RateGuide } from "@/components/RateGuide";
import api, { formatApiErrorDetail } from "@/lib/api";
import { formatDateTime } from "@/lib/projectUtils";

const Row = ({ label, value, mono }) => (
  <div className="flex flex-wrap items-baseline gap-2 py-1.5">
    <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 w-32 shrink-0">{label}</span>
    <span className={`text-sm text-slate-200 break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
  </div>
);

export default function SettingsPage() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const [params, setParams] = useSearchParams();

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get("/integrations/gmail");
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Google sends the browser back here after consent.
  useEffect(() => {
    const result = params.get("gmail");
    if (!result) return;
    if (result === "connected") toast.success(`Gmail connected — ${params.get("address") || ""}`);
    else toast.error(`Could not connect Gmail (${params.get("reason") || "unknown"}).`);
    setParams({}, { replace: true });
    fetchStatus();
  }, [params, setParams, fetchStatus]);

  const connect = async () => {
    setBusy(true);
    try {
      const { data } = await api.get("/integrations/gmail/authorize");
      window.location.href = data.auth_url;   // hand off to Google
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not start the Gmail connection.");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    try {
      await api.post("/integrations/gmail/disconnect");
      toast.success("Gmail disconnected.");
      fetchStatus();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not disconnect.");
    }
  };

  const poll = async () => {
    setPolling(true);
    try {
      const { data } = await api.post("/integrations/gmail/poll", {}, { timeout: 180000 });
      if (data.ingested > 0) toast.success(`${data.ingested} new quote(s) picked up from your inbox.`);
      else toast.info("No new replies.");
      if (data.errors?.length) toast.warning(data.errors[0]);
      fetchStatus();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not check for replies.");
    } finally {
      setPolling(false);
    }
  };

  return (
    <main className="max-w-5xl mx-auto px-6 py-10" data-testid="settings-page">
      <h1 className="font-heading text-3xl font-bold tracking-tight text-slate-100 mb-1">Settings</h1>
      <p className="text-sm text-slate-400 mb-8">
        The services BuildManager sends and receives through, and the rates it prices from.
      </p>

      <section className="rounded-md border border-slate-700 bg-card" data-testid="gmail-card">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-slate-700">
          <Mail className="h-5 w-5 text-amber-400" aria-hidden="true" />
          <h2 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100 flex-1">Gmail</h2>
          {status && (
            <Badge variant="outline" data-testid="gmail-status-badge"
              className={`uppercase tracking-wider text-[10px] ${
                status.connected ? "bg-emerald-600/20 text-emerald-400 border-emerald-600/40"
                  : status.configured ? "bg-slate-500/15 text-slate-400 border-slate-500/40"
                    : "bg-amber-500/15 text-amber-400 border-amber-500/50"
              }`}>
              {status.connected ? "Connected" : status.configured ? "Not connected" : "Needs setup"}
            </Badge>
          )}
        </div>

        <div className="p-5">
          {!status && <p className="text-sm text-slate-400">Loading…</p>}

          {status && !status.configured && (
            <div data-testid="gmail-needs-setup">
              <p className="text-sm text-slate-300 mb-3">
                The server needs Google credentials before you can connect your mailbox. Create an OAuth
                client in the Google Cloud console, then add its id and secret to <code className="text-amber-400">backend/.env</code>.
              </p>
              <div className="rounded-md border border-slate-700 bg-slate-800/50 p-4 text-xs text-slate-400 space-y-1.5">
                <p className="text-slate-300 font-medium">Redirect URI to register:</p>
                <p className="font-mono text-amber-400 break-all">{status.redirect_uri || "(set PUBLIC_BASE_URL first)"}</p>
                <p className="pt-2">Scopes: gmail.send, gmail.readonly, userinfo.email</p>
              </div>
              <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-sky-400 hover:text-sky-300 mt-3 transition-colors duration-200">
                Open Google Cloud credentials <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
          )}

          {status?.configured && !status.connected && (
            <div data-testid="gmail-connect">
              <p className="text-sm text-slate-300 mb-4">
                Connect your mailbox so quote requests are sent from your own address and replies come
                straight back into the job. No password is stored — you can revoke access from your Google
                account at any time.
              </p>
              <Button data-testid="gmail-connect-button" disabled={busy} onClick={connect}
                className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
                Connect Gmail
              </Button>
            </div>
          )}

          {status?.connected && (
            <div data-testid="gmail-connected">
              <div className="mb-4">
                <Row label="Sending as" value={status.email_address} />
                <Row label="Connected" value={status.connected_at ? formatDateTime(status.connected_at) : "—"} />
                <Row label="Last checked" value={status.last_poll_at ? formatDateTime(status.last_poll_at) : "never"} />
              </div>

              {status.last_error && (
                <p className="flex items-start gap-2 text-xs text-red-400 mb-4 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2"
                  data-testid="gmail-error">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  {status.last_error}
                </p>
              )}

              <p className="flex items-start gap-2 text-xs text-slate-400 mb-4">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
                Replies to a quote request are read back automatically. A price found in the reply is added
                as a draft for you to confirm — nothing is ever accepted on your behalf.
              </p>

              <div className="flex flex-wrap gap-3">
                <Button variant="outline" data-testid="gmail-poll-button" disabled={polling} onClick={poll}
                  className="border-slate-600 text-slate-300 hover:text-amber-400">
                  <RefreshCw className={`h-4 w-4 ${polling ? "animate-spin" : ""}`} aria-hidden="true" />
                  {polling ? "Checking…" : "Check for replies now"}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" data-testid="gmail-disconnect-button"
                      className="border-slate-600 text-slate-400 hover:text-red-400">
                      <Unplug className="h-4 w-4" aria-hidden="true" /> Disconnect
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-card border-slate-700">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-slate-100">Disconnect Gmail?</AlertDialogTitle>
                      <AlertDialogDescription className="text-slate-400">
                        Quote requests will stop sending from your address and replies will no longer be read
                        in. Quotes already received are kept.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="border-slate-600 text-slate-300">Cancel</AlertDialogCancel>
                      <AlertDialogAction data-testid="gmail-disconnect-confirm" onClick={disconnect}
                        className="bg-red-600 text-white hover:bg-red-500">Disconnect</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="mt-10 pt-10 border-t border-slate-800">
        <RateGuide />
      </div>
    </main>
  );
}
