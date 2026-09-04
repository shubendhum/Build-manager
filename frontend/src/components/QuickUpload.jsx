import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Upload, FileUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import api, { formatApiErrorDetail } from "@/lib/api";

const CATEGORIES = [
  { value: "drawings", label: "Drawings" },
  { value: "permits", label: "Permits" },
  { value: "contracts", label: "Contracts" },
  { value: "insurance", label: "Insurance" },
  { value: "certificates", label: "Certificates" },
  { value: "other", label: "Other" },
];

/**
 * Uploading was three levels deep — More, then Files, then Documents — which is
 * a long way for the thing you do every time a consultant emails a revision.
 * This lives in the job header on every tab, and the whole page accepts a drop.
 */
export const QuickUpload = ({ projectId, onUploaded }) => {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [category, setCategory] = useState("drawings");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const depth = useRef(0);          // dragenter/leave fire per child element

  // Drop anywhere on the job, not just on a target you have to find first.
  useEffect(() => {
    const over = (e) => { e.preventDefault(); };
    const enter = (e) => {
      if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
      depth.current += 1;
      setDragging(true);
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const drop = (e) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const dropped = [...(e.dataTransfer?.files || [])];
      if (dropped.length) { setFiles(dropped); setOpen(true); }
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const pick = (e) => {
    const chosen = [...(e.target.files || [])];
    if (chosen.length) { setFiles(chosen); setOpen(true); }
    e.target.value = "";
  };

  const upload = useCallback(async () => {
    if (!files.length) return;
    setBusy(true);
    let ok = 0;
    const failed = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("category", category);
      fd.append("title", file.name.replace(/\.[^.]+$/, ""));
      try {
        await api.post(`/projects/${projectId}/documents`, fd, { timeout: 120000 });
        ok += 1;
      } catch (e) {
        failed.push(`${file.name}: ${formatApiErrorDetail(e.response?.data?.detail) || "failed"}`);
      }
    }
    setBusy(false);
    setOpen(false);
    setFiles([]);
    if (ok) toast.success(`${ok} file${ok === 1 ? "" : "s"} uploaded`);
    // Name what failed and why — "some files failed" is no use to anyone.
    failed.forEach((f) => toast.error(f));
    if (ok) onUploaded?.();
  }, [files, category, projectId, onUploaded]);

  return (
    <>
      <Button size="sm" variant="outline" data-testid="quick-upload-button"
        onClick={() => inputRef.current?.click()}
        className="border-amber-500/50 bg-transparent text-amber-400 hover:bg-amber-500/10 hover:text-amber-300">
        <Upload className="h-4 w-4" aria-hidden="true" /> Upload
      </Button>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={pick}
        data-testid="quick-upload-input"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.csv,.txt" />

      {dragging && (
        <div className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center pointer-events-none"
          data-testid="drop-overlay">
          <div className="rounded-lg border-2 border-dashed border-amber-500 bg-slate-900/90 px-10 py-8 text-center">
            <FileUp className="h-10 w-10 text-amber-400 mx-auto mb-3" aria-hidden="true" />
            <p className="font-heading text-lg font-bold text-slate-100">Drop to add to this job</p>
            <p className="text-xs text-slate-400 mt-1">Drawings, permits, certificates — anything</p>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!busy) { setOpen(v); if (!v) setFiles([]); } }}>
        <DialogContent className="max-w-md bg-card border-slate-700" data-testid="quick-upload-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl font-bold text-slate-100">
              Add {files.length} file{files.length === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-sm">
              Filed against this job. Drawings are offered first when you send a quote request.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="rounded-md border border-slate-700 divide-y divide-slate-800 max-h-44 overflow-y-auto">
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} className="flex items-center gap-2 px-3 py-2">
                  <span className="text-xs text-slate-200 flex-1 min-w-0 break-words">{f.name}</span>
                  <span className="text-[11px] text-slate-500 shrink-0">
                    {(f.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                  <button type="button" title="Remove" aria-label="Remove"
                    onClick={() => setFiles((s) => s.filter((_, x) => x !== i))}
                    className="text-slate-500 hover:text-red-400 shrink-0">
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Filed as</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="quick-upload-category" className="bg-slate-800/50 border-slate-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-slate-700">
                  {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" disabled={busy} onClick={() => { setOpen(false); setFiles([]); }}
                className="border-slate-600 text-slate-300">Cancel</Button>
              <Button data-testid="quick-upload-confirm" disabled={busy || !files.length} onClick={upload}
                className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Uploading…</>
                      : <>Upload {files.length}</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
