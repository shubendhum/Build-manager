import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { HardHat, Loader2, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { UploadZone } from "@/components/UploadZone";
import { AnalysisResult } from "@/components/AnalysisResult";
import { HistoryGrid } from "@/components/HistoryGrid";
import { STAGES } from "@/lib/stages";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function AnalyzePage() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [stageHint, setStageHint] = useState("auto");
  const [notes, setNotes] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/photos`);
      setHistory(data);
    } catch (e) {
      console.error("Failed to load history", e);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const onFileSelected = (f) => {
    setFile(f);
    setResult(null);
    setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(f); });
  };

  const onClear = () => {
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  };

  const handleAnalyze = async () => {
    if (!file) { toast.error("Select a construction photo first."); return; }
    setAnalyzing(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (stageHint !== "auto") fd.append("project_stage", stageHint);
      if (notes.trim()) fd.append("notes", notes.trim());
      const { data } = await axios.post(`${API}/photos/analyze`, fd);
      setResult(data);
      fetchHistory();
      toast.success("AI analysis complete");
    } catch (e) {
      const detail = e.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Analysis failed. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background blueprint-grid">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-slate-900/80 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-md bg-amber-500 flex items-center justify-center">
            <HardHat className="h-5 w-5 text-slate-950" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-heading text-lg font-bold tracking-tight text-slate-100 leading-none">
              BuildManager <span className="text-amber-400">VIC</span>
            </h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mt-0.5">Phase 0 — AI Photo Analysis</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-10">
          <p className="text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold mb-2">Site Progress Intelligence</p>
          <h2 className="font-heading text-4xl sm:text-5xl font-bold tracking-tight text-slate-100">Analyze a construction photo</h2>
          <p className="text-sm text-slate-400 mt-3 max-w-2xl">
            Upload a site photo and the AI will identify the Victorian construction stage, draft site diary notes,
            and flag visible defects or safety concerns.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
          <div className="lg:col-span-2 rounded-md border border-slate-700 bg-card p-6 space-y-5">
            <UploadZone file={file} previewUrl={previewUrl} onFileSelected={onFileSelected} onClear={onClear} disabled={analyzing} />

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold">Stage hint (optional)</label>
              <Select value={stageHint} onValueChange={setStageHint} disabled={analyzing}>
                <SelectTrigger data-testid="stage-hint-select" className="bg-slate-800/50 border-slate-600">
                  <SelectValue placeholder="Auto-detect stage" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto" data-testid="stage-option-auto">Auto-detect stage</SelectItem>
                  {STAGES.map((s) => (
                    <SelectItem key={s.value} value={s.value} data-testid={`stage-option-${s.value.replace("/", "-")}`}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold">Notes for the AI (optional)</label>
              <Textarea
                data-testid="notes-input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={analyzing}
                placeholder="e.g. Double-storey build in Werribee, day after frame inspection…"
                className="bg-slate-800/50 border-slate-600 min-h-[80px] text-sm"
              />
            </div>

            <Button
              data-testid="analyze-button"
              onClick={handleAnalyze}
              disabled={analyzing || !file}
              className="w-full bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200 h-11"
            >
              {analyzing ? (
                <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Analyzing photo…</>
              ) : (
                <><ScanSearch className="h-4 w-4" aria-hidden="true" /> Analyze</>
              )}
            </Button>
          </div>

          <div className="lg:col-span-3">
            {analyzing && (
              <div data-testid="analyzing-indicator" className="rounded-md border border-slate-700 bg-card p-10 flex flex-col items-center gap-4">
                <Loader2 className="h-8 w-8 text-amber-400 animate-spin" aria-hidden="true" />
                <p className="text-sm text-slate-300">AI is inspecting the photo — identifying stage, materials and risks…</p>
                <div className="w-full max-w-xs h-1 rounded bg-slate-700 overflow-hidden">
                  <div className="h-full w-1/2 bg-amber-500 animate-pulse" />
                </div>
              </div>
            )}
            {!analyzing && result && <AnalysisResult result={result} />}
            {!analyzing && !result && (
              <div data-testid="result-placeholder" className="rounded-md border border-dashed border-slate-700 bg-slate-800/20 p-10 text-center">
                <p className="text-sm text-slate-500">Analysis results will appear here.</p>
              </div>
            )}
          </div>
        </div>

        <HistoryGrid history={history} loading={historyLoading} />
      </main>

      <footer className="border-t border-slate-800 mt-16">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <p className="text-xs text-slate-600">BuildManager VIC — construction project management for Victorian builders. Phase 0 POC.</p>
        </div>
      </footer>
    </div>
  );
}
