import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Camera, ChevronDown, Trash2, FileDown, Loader2, AlertTriangle, Sparkles, NotebookPen, Pencil, Users, Thermometer, CloudSun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { UploadZone } from "@/components/UploadZone";
import { AnalysisResult } from "@/components/AnalysisResult";
import { DatePicker } from "@/components/DatePicker";
import { DiaryEntryDialog, weatherLabel } from "@/components/DiaryEntryDialog";
import api, { formatApiErrorDetail, readBlobError, downloadBlob } from "@/lib/api";
import { STAGES, stageLabel, CONFIDENCE_STYLES } from "@/lib/stages";
import { formatDateTime, formatDate } from "@/lib/projectUtils";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const PHOTO_STAGE_ORDER = [...STAGES.map((s) => s.value), "unknown"];
const ROADMAP_TO_PHOTO_STAGE = {
  "pre-construction": "site-preparation", base: "base/slab", frame: "frame",
  lockup: "lockup", fixing: "fixing", completion: "completion",
};

const PhotoCard = ({ photo, onDelete }) => {
  const [open, setOpen] = useState(false);
  const a = photo.analysis;
  return (
    <article data-testid={`photo-card-${photo.id}`} className="rounded-md border border-slate-700 bg-card overflow-hidden">
      <img src={`${BACKEND_URL}${photo.image_url}`} alt={`Site photo — ${stageLabel(a.identified_stage)}`}
        className="w-full h-44 object-cover border-b border-slate-700" loading="lazy" />
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/40 hover:bg-amber-500/15 uppercase tracking-wider text-[10px]">
            {stageLabel(a.identified_stage)}
          </Badge>
          <Badge variant="outline" className={`uppercase tracking-wider text-[10px] ${CONFIDENCE_STYLES[a.confidence] || CONFIDENCE_STYLES.medium}`}>
            {a.confidence}
          </Badge>
          {a.potential_issues.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-red-400">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {a.potential_issues.length} issue{a.potential_issues.length === 1 ? "" : "s"}
            </span>
          )}
          <span className="ml-auto text-xs text-slate-500">{formatDateTime(photo.created_at)}</span>
        </div>
        {!open && <p className="text-sm text-slate-300 leading-relaxed line-clamp-2">{a.progress_notes}</p>}
        {open && (
          <div className="space-y-3" data-testid={`photo-analysis-${photo.id}`}>
            <p className="text-sm text-slate-200 leading-relaxed">{a.progress_notes}</p>
            {a.observations.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold mb-1">Observations</p>
                <ul className="space-y-1">
                  {a.observations.map((obs, i) => (
                    <li key={i} className="text-sm text-slate-300 flex gap-2"><span className="text-amber-500 shrink-0 mt-0.5">▸</span>{obs}</li>
                  ))}
                </ul>
              </div>
            )}
            {a.potential_issues.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-red-400 font-semibold mb-1">Potential Issues</p>
                <ul className="space-y-1.5">
                  {a.potential_issues.map((issue, i) => (
                    <li key={i} className="text-sm text-red-200 flex gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5">
                      <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />{issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <div className="flex items-center justify-between pt-1 border-t border-slate-800">
          <button data-testid={`photo-expand-${photo.id}`} onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-amber-400 transition-colors duration-200">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
            {open ? "Hide analysis" : "Full analysis"}
          </button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button data-testid={`photo-delete-${photo.id}`}
                className="p-1.5 rounded-md text-slate-500 hover:text-red-400 transition-colors duration-200" title="Delete" aria-label="Delete">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-card border-slate-700">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-slate-100">Delete this photo?</AlertDialogTitle>
                <AlertDialogDescription className="text-slate-400">
                  The photo and its AI analysis will be permanently removed from the project record.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-slate-100">Cancel</AlertDialogCancel>
                <AlertDialogAction data-testid={`photo-delete-confirm-${photo.id}`} onClick={() => onDelete(photo)}
                  className="bg-red-600 text-white hover:bg-red-500">Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </article>
  );
};

const DiaryEntryCard = ({ entry, onEdit, onDelete }) => (
  <article data-testid={`diary-entry-${entry.id}`}
    className="rounded-md border border-slate-700 bg-card p-4 border-l-2 border-l-amber-500/70">
    <div className="flex flex-wrap items-center gap-2 mb-2">
      <Badge className="bg-slate-700/60 text-slate-200 border border-slate-600 hover:bg-slate-700/60 uppercase tracking-wider text-[10px]">
        <NotebookPen className="h-3 w-3 mr-1" aria-hidden="true" /> Diary entry
      </Badge>
      {entry.weather && (
        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
          <CloudSun className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" /> {weatherLabel(entry.weather)}
        </span>
      )}
      {entry.temp_c != null && (
        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
          <Thermometer className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" /> {entry.temp_c}°C
        </span>
      )}
      <span className="ml-auto flex items-center gap-1">
        <button data-testid={`diary-edit-${entry.id}`} onClick={() => onEdit(entry)}
          className="p-1.5 rounded-md text-slate-500 hover:text-amber-400 transition-colors duration-200">
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button data-testid={`diary-delete-${entry.id}`}
              className="p-1.5 rounded-md text-slate-500 hover:text-red-400 transition-colors duration-200" title="Delete" aria-label="Delete">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
          </AlertDialogTrigger>
          <AlertDialogContent className="bg-card border-slate-700">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-slate-100">Delete this diary entry?</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                The entry for {formatDate(entry.date)} will be permanently removed from the site diary.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-slate-100">Cancel</AlertDialogCancel>
              <AlertDialogAction data-testid={`diary-delete-confirm-${entry.id}`} onClick={() => onDelete(entry)}
                className="bg-red-600 text-white hover:bg-red-500">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </span>
    </div>
    {entry.crew?.length > 0 && (
      <p className="inline-flex flex-wrap items-center gap-1.5 text-xs text-slate-400 mb-2">
        <Users className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
        {entry.crew.map((c, i) => (
          <span key={i} className="rounded bg-slate-800/70 border border-slate-700 px-1.5 py-0.5 text-slate-300">
            {c.trade} ×{c.count}
          </span>
        ))}
      </p>
    )}
    {entry.notes && <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{entry.notes}</p>}
  </article>
);

export const PhotosTab = ({ project }) => {
  const [photos, setPhotos] = useState(null);
  const [entries, setEntries] = useState(null);
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [stageTag, setStageTag] = useState("none");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [filter, setFilter] = useState("all");
  const [exportOpen, setExportOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exporting, setExporting] = useState(false);

  const fetchPhotos = useCallback(async () => {
    const { data } = await api.get("/photos", { params: { project_id: project.id } });
    setPhotos(data);
  }, [project.id]);

  const fetchEntries = useCallback(async () => {
    const { data } = await api.get(`/projects/${project.id}/diary`);
    setEntries(data);
  }, [project.id]);

  useEffect(() => { fetchPhotos(); }, [fetchPhotos]);
  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const deleteEntry = async (entry) => {
    try {
      await api.delete(`/diary/${entry.id}`);
      setEntries((e) => e.filter((x) => x.id !== entry.id));
      toast.success("Diary entry deleted.");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  // Default stage tag = the project's current in-progress roadmap stage
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/projects/${project.id}/roadmap`);
        const stages = data.stages || [];
        const current = stages.find((s) => s.tasks.some((t) => t.status === "in-progress"))
          || stages.find((s) => s.done_count < s.relevant_count);
        if (current && ROADMAP_TO_PHOTO_STAGE[current.key]) setStageTag(ROADMAP_TO_PHOTO_STAGE[current.key]);
      } catch { /* default stays "none" */ }
    })();
  }, [project.id]);

  const onFileSelected = (f) => {
    setFile(f);
    setResult(null);
    setPreviewUrl(URL.createObjectURL(f));
  };
  const onClear = () => { setFile(null); setPreviewUrl(null); };

  const analyze = async () => {
    if (!file) return;
    setAnalyzing(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("project_id", project.id);
      if (stageTag !== "none") fd.append("project_stage", stageTag);
      const { data } = await api.post("/photos/analyze", fd, { timeout: 120000 });
      setResult(data);
      setPhotos((p) => [data, ...(p || [])]);
      onClear();
      toast.success("Photo analysed and saved to the job.");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setAnalyzing(false);
    }
  };

  const deletePhoto = async (photo) => {
    try {
      await api.delete(`/photos/${photo.id}`);
      setPhotos((p) => p.filter((x) => x.id !== photo.id));
      if (result?.id === photo.id) setResult(null);
      toast.success("Photo deleted.");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  const exportDiary = async () => {
    setExporting(true);
    try {
      const params = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const { data } = await api.get(`/projects/${project.id}/site-diary.pdf`, { params, responseType: "blob", timeout: 60000 });
      downloadBlob(data, `Site-Diary-${project.name.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`);
      setExportOpen(false);
      toast.success("Site Diary PDF downloaded.");
    } catch (e) {
      toast.error(await readBlobError(e));
    } finally {
      setExporting(false);
    }
  };

  if (!photos || !entries) return <p className="text-sm text-slate-400">Loading site diary…</p>;

  const filtered = filter === "all" ? photos : photos.filter((p) => p.analysis.identified_stage === filter);
  const shownEntries = filter === "all" ? entries : [];

  // Merge manual diary entries and photo analyses into one chronological feed (newest day first)
  const dayMap = {};
  shownEntries.forEach((e) => {
    (dayMap[e.date] = dayMap[e.date] || { entries: [], photos: [] }).entries.push(e);
  });
  filtered.forEach((p) => {
    const key = p.created_at.slice(0, 10);
    (dayMap[key] = dayMap[key] || { entries: [], photos: [] }).photos.push(p);
  });
  const feed = Object.keys(dayMap).sort().reverse().map((date) => ({ date, ...dayMap[date] }));
  const hasAnyRecord = photos.length > 0 || entries.length > 0;

  return (
    <div data-testid="photos-tab">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-10 items-start">
        <div className="rounded-md border border-slate-700 bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-amber-400" aria-hidden="true" />
            <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Add a progress photo</h3>
          </div>
          <UploadZone file={file} previewUrl={previewUrl} onFileSelected={onFileSelected} onClear={onClear} disabled={analyzing} />
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="text-[10px] uppercase tracking-[0.2em] text-slate-500 block mb-1.5">Stage tag (optional)</label>
              <Select value={stageTag} onValueChange={setStageTag} disabled={analyzing}>
                <SelectTrigger data-testid="photo-stage-select" className="bg-slate-800/50 border-slate-600 text-slate-200">
                  <SelectValue placeholder="No stage hint" />
                </SelectTrigger>
                <SelectContent className="bg-card border-slate-700">
                  <SelectItem value="none">No stage hint</SelectItem>
                  {STAGES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button data-testid="photo-analyze-button" onClick={analyze} disabled={!file || analyzing}
              className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              {analyzing ? (<><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Analysing…</>) : (<><Sparkles className="h-4 w-4" aria-hidden="true" /> Analyze</>)}
            </Button>
          </div>
          {analyzing && <p className="text-xs text-slate-500">The AI is reviewing the photo — this can take up to 30 seconds.</p>}
        </div>
        <div>
          {result ? (
            <AnalysisResult result={result} />
          ) : (
            <div className="rounded-md border border-dashed border-slate-700 bg-slate-800/20 p-8 text-center h-full flex items-center justify-center">
              <p className="text-sm text-slate-500">Upload a site photo and the AI analysis will appear here, then save to the gallery below.</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Site diary</h3>
          <span className="text-xs text-slate-500" data-testid="photos-count">
            {entries.length} entr{entries.length === 1 ? "y" : "ies"} · {photos.length} photo{photos.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button data-testid="add-diary-entry-button" onClick={() => { setEditingEntry(null); setEntryDialogOpen(true); }}
            className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
            <NotebookPen className="h-4 w-4" aria-hidden="true" /> Add Diary Entry
          </Button>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger data-testid="photo-filter-select" className="w-44 bg-slate-800/50 border-slate-600 text-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-slate-700">
              <SelectItem value="all">All stages</SelectItem>
              {PHOTO_STAGE_ORDER.map((s) => <SelectItem key={s} value={s}>{stageLabel(s)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button data-testid="export-diary-button" variant="outline" onClick={() => setExportOpen(true)} disabled={!hasAnyRecord}
            className="border-amber-500/50 bg-transparent text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 font-heading font-bold uppercase tracking-wider">
            <FileDown className="h-4 w-4" aria-hidden="true" /> Export Site Diary
          </Button>
        </div>
      </div>

      {!hasAnyRecord && (
        <div data-testid="photos-empty" className="rounded-md border border-slate-700 bg-slate-800/30 p-10 text-center">
          <NotebookPen className="h-8 w-8 text-slate-600 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-slate-400 mb-1">The site diary is empty.</p>
          <p className="text-xs text-slate-500 mb-4">Upload a progress photo above, or record conditions, crew and notes for today.</p>
          <Button data-testid="diary-empty-add" onClick={() => { setEditingEntry(null); setEntryDialogOpen(true); }}
            className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
            <NotebookPen className="h-4 w-4" aria-hidden="true" /> Add Diary Entry
          </Button>
        </div>
      )}
      {hasAnyRecord && feed.length === 0 && (
        <p className="text-sm text-slate-500" data-testid="photos-filter-empty">No photos identified as {stageLabel(filter)}.</p>
      )}

      {feed.map((day) => (
        <section key={day.date} className="mb-8" data-testid={`diary-day-${day.date}`}>
          <div className="flex items-center gap-2 mb-3">
            <h4 className="text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold">{formatDate(day.date)}</h4>
            <span className="text-xs text-slate-600">{day.entries.length + day.photos.length}</span>
            <div className="flex-1 h-px bg-slate-800" />
          </div>
          {day.entries.length > 0 && (
            <div className="space-y-3 mb-4">
              {day.entries.map((e) => (
                <DiaryEntryCard key={e.id} entry={e} onDelete={deleteEntry}
                  onEdit={(entry) => { setEditingEntry(entry); setEntryDialogOpen(true); }} />
              ))}
            </div>
          )}
          {day.photos.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 items-start">
              {day.photos.map((p) => <PhotoCard key={p.id} photo={p} onDelete={deletePhoto} />)}
            </div>
          )}
        </section>
      ))}

      <DiaryEntryDialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen} projectId={project.id}
        entry={editingEntry} onSaved={fetchEntries} />

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="bg-card border-slate-700 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading uppercase tracking-wider text-slate-100">Export the site diary</DialogTitle>
            <DialogDescription className="text-slate-400">
              Generates a PDF of date-grouped photo entries with AI notes. Leave dates empty to include everything.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-[0.2em] text-slate-500 block mb-1.5">From</label>
              <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="Start date" testId="diary-date-from" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.2em] text-slate-500 block mb-1.5">To</label>
              <DatePicker value={dateTo} onChange={setDateTo} placeholder="End date" testId="diary-date-to" />
            </div>
          </div>
          <DialogFooter>
            <Button data-testid="diary-export-confirm" onClick={exportDiary} disabled={exporting}
              className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              {exporting ? (<><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Generating…</>) : (<><FileDown className="h-4 w-4" aria-hidden="true" /> Export PDF</>)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
