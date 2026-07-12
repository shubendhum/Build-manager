import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { FolderOpen, Plus, FileText, Download, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import api, { formatApiErrorDetail, readBlobError, downloadBlob } from "@/lib/api";
import { formatDate } from "@/lib/projectUtils";

export const DOC_CATEGORIES = [
  { value: "drawings", label: "Drawings" },
  { value: "permits", label: "Permits" },
  { value: "contracts", label: "Contracts" },
  { value: "insurance", label: "Insurance" },
  { value: "certificates", label: "Certificates" },
  { value: "other", label: "Other" },
];
const categoryLabel = (v) => DOC_CATEGORIES.find((c) => c.value === v)?.label || v;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.csv,.txt";
const MAX_BYTES = 15 * 1024 * 1024;

const formatBytes = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export const DocumentsTab = ({ projectId }) => {
  const [docs, setDocs] = useState(null);
  const [filter, setFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("other");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const fetchDocs = useCallback(async () => {
    const { data } = await api.get(`/projects/${projectId}/documents`);
    setDocs(data);
  }, [projectId]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const onFilePicked = (f) => {
    if (!f) return;
    if (f.size > MAX_BYTES) { toast.error("File too large. Maximum size is 15 MB."); return; }
    setFile(f);
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  const resetForm = () => { setFile(null); setTitle(""); setCategory("other"); setNotes(""); };

  const upload = async () => {
    if (!file) { toast.error("Choose a file to upload."); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title.trim());
      fd.append("category", category);
      fd.append("notes", notes.trim());
      const { data } = await api.post(`/projects/${projectId}/documents`, fd, { timeout: 60000 });
      setDocs((d) => [data, ...(d || [])]);
      setDialogOpen(false);
      resetForm();
      toast.success("Document uploaded.");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setUploading(false);
    }
  };

  const download = async (doc) => {
    try {
      const { data } = await api.get(`/documents/${doc.id}/download`, { responseType: "blob", timeout: 60000 });
      downloadBlob(data, doc.filename);
    } catch (e) {
      toast.error(await readBlobError(e));
    }
  };

  const remove = async (doc) => {
    try {
      await api.delete(`/documents/${doc.id}`);
      setDocs((d) => d.filter((x) => x.id !== doc.id));
      toast.success("Document deleted.");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  if (!docs) return <p className="text-sm text-slate-400">Loading documents…</p>;
  const filtered = filter === "all" ? docs : docs.filter((d) => d.category === filter);

  return (
    <div data-testid="documents-tab">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-amber-400" aria-hidden="true" />
          <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Documents</h3>
          <span className="text-xs text-slate-500" data-testid="documents-count">{docs.length} file{docs.length === 1 ? "" : "s"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger data-testid="document-filter-select" className="w-44 bg-slate-800/50 border-slate-600 text-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-slate-700">
              <SelectItem value="all">All categories</SelectItem>
              {DOC_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button data-testid="add-document-button" onClick={() => setDialogOpen(true)}
            className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
            <Plus className="h-4 w-4" aria-hidden="true" /> Upload
          </Button>
        </div>
      </div>

      {docs.length === 0 && (
        <div data-testid="documents-empty" className="rounded-md border border-slate-700 bg-slate-800/30 p-10 text-center">
          <p className="text-sm text-slate-400">No documents yet. Upload drawings, permits, contracts, insurance and certificates to keep the project file in one place.</p>
        </div>
      )}
      {docs.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-slate-500" data-testid="documents-filter-empty">No documents in {categoryLabel(filter)}.</p>
      )}

      <div className="space-y-2.5">
        {filtered.map((doc) => (
          <div key={doc.id} data-testid={`document-row-${doc.id}`}
            className="rounded-md border border-slate-700 bg-card px-4 py-3 flex flex-wrap items-center gap-3 hover:border-slate-600 transition-colors duration-200">
            <div className="h-9 w-9 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
              <FileText className="h-4.5 w-4.5 text-amber-400" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-medium text-slate-200" data-testid={`document-title-${doc.id}`}>{doc.title}</p>
              <p className="text-xs text-slate-500 truncate">
                {doc.filename} · {formatBytes(doc.file_size)} · Uploaded {formatDate(doc.uploaded_at)}
              </p>
              {doc.notes && <p className="text-xs text-slate-400 mt-0.5">{doc.notes}</p>}
            </div>
            <Badge variant="outline" className="border-slate-600 text-slate-300 uppercase tracking-wider text-[10px]">
              {categoryLabel(doc.category)}
            </Badge>
            <div className="flex gap-1">
              <button data-testid={`document-download-${doc.id}`} onClick={() => download(doc)} title="Download"
                className="p-2 rounded-md text-slate-400 hover:text-amber-400 transition-colors duration-200">
                <Download className="h-4 w-4" aria-hidden="true" />
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button data-testid={`document-delete-${doc.id}`} title="Delete"
                    className="p-2 rounded-md text-slate-500 hover:text-red-400 transition-colors duration-200">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-card border-slate-700">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-slate-100">Delete "{doc.title}"?</AlertDialogTitle>
                    <AlertDialogDescription className="text-slate-400">The file will be permanently removed from the project.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-slate-100">Cancel</AlertDialogCancel>
                    <AlertDialogAction data-testid={`document-delete-confirm-${doc.id}`} onClick={() => remove(doc)}
                      className="bg-red-600 text-white hover:bg-red-500">Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="bg-card border-slate-700 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading uppercase tracking-wider text-slate-100">Upload Document</DialogTitle>
            <DialogDescription className="text-slate-400">PDF, images, Word, Excel, CSV or text — up to 15 MB.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div
              role="button" tabIndex={0}
              data-testid="document-dropzone"
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
              className="cursor-pointer rounded-md border-2 border-dashed border-slate-600 bg-slate-800/30 hover:border-amber-500 hover:bg-slate-800/50 p-6 text-center transition-colors duration-200"
            >
              {file ? (
                <p className="text-sm text-slate-200" data-testid="document-selected-file">{file.name} <span className="text-slate-500">({formatBytes(file.size)})</span></p>
              ) : (
                <p className="text-sm text-slate-400">Click to choose a file</p>
              )}
              <input ref={fileRef} data-testid="document-file-input" type="file" accept={ACCEPT} className="hidden"
                onChange={(e) => onFilePicked(e.target.files?.[0])} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.2em] text-slate-500 block mb-1.5">Title</label>
              <Input data-testid="document-title-input" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Working drawings Rev C" className="bg-slate-800/50 border-slate-600 text-slate-200" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.2em] text-slate-500 block mb-1.5">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="document-category-select" className="bg-slate-800/50 border-slate-600 text-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-slate-700">
                  {DOC_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.2em] text-slate-500 block mb-1.5">Notes (optional)</label>
              <Textarea data-testid="document-notes-input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                placeholder="Anything worth noting about this document" className="bg-slate-800/50 border-slate-600 text-slate-200" />
            </div>
          </div>
          <DialogFooter>
            <Button data-testid="document-upload-submit" onClick={upload} disabled={uploading || !file}
              className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              {uploading ? (<><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Uploading…</>) : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
