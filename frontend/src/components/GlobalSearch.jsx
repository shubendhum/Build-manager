import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, FolderKanban, Hammer, FileText, Loader2 } from "lucide-react";
import api from "@/lib/api";

const TYPE_META = {
  project: { icon: FolderKanban, label: "Project" },
  trade: { icon: Hammer, label: "Trade" },
  quote: { icon: FileText, label: "Quote" },
};

const resultTarget = (r) => {
  if (r.type === "project") return `/projects/${r.id}`;
  if (r.type === "quote") return `/projects/${r.project_id}`;
  return "/trades";
};

export const GlobalSearch = ({ compact = false }) => {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);

  // Debounced search
  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); setBusy(false); return; }
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/search", { params: { q } });
        setResults(data.results);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // Close on outside click
  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (r) => {
    setOpen(false);
    setQ("");
    setResults(null);
    navigate(resultTarget(r));
  };

  return (
    <div ref={boxRef} className={`relative ${compact ? "" : "px-3 pt-3"}`}>
      <div className="relative">
        {busy
          ? <Loader2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-amber-400 animate-spin" aria-hidden="true" />
          : <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" aria-hidden="true" />}
        <input
          data-testid={compact ? "global-search-input-mobile" : "global-search-input"}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => { if (results) setOpen(true); }}
          placeholder="Search projects, trades, quotes…"
          className="w-full rounded-md border border-slate-700 bg-slate-800/60 pl-8 pr-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-amber-500/60 transition-colors duration-200"
        />
      </div>
      {open && results && (
        <div data-testid="global-search-results"
          className={`absolute z-50 mt-1.5 rounded-md border border-slate-700 bg-slate-900 shadow-xl shadow-black/40 overflow-hidden ${compact ? "left-0 right-0" : "left-3 right-3"}`}>
          {results.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-500" data-testid="global-search-empty">No matches for “{q}”.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-slate-800">
              {results.map((r) => {
                const meta = TYPE_META[r.type] || TYPE_META.project;
                return (
                  <li key={`${r.type}-${r.id}`}>
                    <button data-testid={`search-result-${r.type}-${r.id}`} onClick={() => go(r)}
                      className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-slate-800/70 transition-colors duration-150">
                      <meta.icon className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block text-xs font-medium text-slate-200 truncate">{r.title}</span>
                        <span className="block text-[10px] uppercase tracking-wider text-slate-500 truncate">
                          {meta.label}{r.subtitle ? ` · ${r.subtitle}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
