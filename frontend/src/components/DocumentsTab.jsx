import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { FolderOpen, FileText, Download, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const formatBytes = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export const DocumentsTab = ({ projectId }) => {
  const [docs, setDocs] = useState(null);
  const [filter, setFilter] = useState("all");
  const fetchDocs = useCallback(async () => {
    const { data } = await api.get(`/projects/${projectId}/documents`);
    setDocs(data);
  }, [projectId]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

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
          <QuickUpload projectId={projectId} onUploaded={fetchDocs} dropTarget={false} label="Add files" />
        </div>
      </div>

      {docs.length === 0 && (
        <div data-testid="documents-empty" className="rounded-md border border-slate-700 bg-slate-800/30 p-10 text-center">
          <p className="text-sm text-slate-400">No documents yet. Upload drawings, permits, contracts, insurance and certificates to keep the job's paperwork in one place.</p>
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

    </div>
  );
};
