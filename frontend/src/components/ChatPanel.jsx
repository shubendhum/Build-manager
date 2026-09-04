import { useState, useRef, useEffect } from "react";
import { MessageSquare, X, Send, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import api, { formatApiErrorDetail } from "@/lib/api";

const SUGGESTIONS = [
  "Where is this job up to?",
  "Who hasn't sent me a price yet?",
  "What do I need to price next?",
  "Compare the screw pile quotes",
];

/**
 * Ask the job a question. Runs against the local model, reads only — it can
 * report what is on the job but cannot send, award or book anything, and says
 * so if asked.
 */
export const ChatPanel = ({ projectId, projectName }) => {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) { endRef.current?.scrollIntoView({ behavior: "smooth" }); inputRef.current?.focus(); }
  }, [turns, open]);

  const ask = async (text) => {
    const question = (text ?? draft).trim();
    if (!question || busy) return;
    setDraft("");
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((t) => [...t, { role: "user", content: question }]);
    setBusy(true);
    try {
      const { data } = await api.post(`/projects/${projectId}/agent/chat`,
        { message: question, history }, { timeout: 600000 });
      setTurns((t) => [...t, { role: "assistant", content: data.answer, tools: data.tools_used }]);
    } catch (e) {
      setTurns((t) => [...t, {
        role: "assistant", error: true,
        content: formatApiErrorDetail(e.response?.data?.detail) || "The assistant is not responding.",
      }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button data-testid="chat-open" onClick={() => setOpen(true)} title="Ask about this job"
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-amber-500 text-slate-950 px-5 py-3 font-heading font-bold uppercase tracking-wider text-sm shadow-lg hover:bg-amber-400 transition-colors duration-200">
        <MessageSquare className="h-4 w-4" aria-hidden="true" /> Ask
      </button>
    );
  }

  return (
    <aside data-testid="chat-panel"
      className="fixed inset-x-0 bottom-0 sm:inset-x-auto sm:right-5 sm:bottom-5 z-40 w-full sm:w-[26rem] max-h-[80vh] sm:max-h-[36rem] flex flex-col rounded-t-lg sm:rounded-lg border border-slate-700 bg-card shadow-2xl">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-700 shrink-0">
        <Sparkles className="h-4 w-4 text-amber-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm font-bold text-slate-100 truncate">Ask about this job</p>
          <p className="text-[11px] text-slate-500 truncate">{projectName}</p>
        </div>
        <button data-testid="chat-close" onClick={() => setOpen(false)} title="Close" aria-label="Close"
          className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 transition-colors duration-200">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {turns.length === 0 && (
          <div data-testid="chat-empty">
            <p className="text-xs text-slate-400 mb-3">
              It reads this job — packages, quotes, trades, drawings and the build sequence.
              It can tell you anything that is on here, but it can't send or change anything.
            </p>
            <div className="space-y-1.5">
              {SUGGESTIONS.map((q) => (
                <button key={q} data-testid={`chat-suggest-${q.slice(0, 12)}`} onClick={() => ask(q)}
                  className="w-full text-left text-xs rounded-md border border-slate-700 bg-slate-800/40 px-3 py-2 text-slate-300 hover:border-amber-500/50 hover:text-amber-400 transition-colors duration-200">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "flex justify-end" : ""}
            data-testid={`chat-turn-${t.role}`}>
            <div className={`rounded-md px-3 py-2 text-sm max-w-[92%] ${
              t.role === "user" ? "bg-amber-500 text-slate-950 font-medium"
                : t.error ? "bg-red-500/10 border border-red-500/40 text-red-300"
                  : "bg-slate-800/60 text-slate-200"
            }`}>
              <p className="whitespace-pre-wrap break-words">{t.content}</p>
              {t.tools?.length > 0 && (
                <p className="text-[10px] text-slate-500 mt-1.5 pt-1.5 border-t border-slate-700/60">
                  read: {t.tools.map((x) => x.tool).join(", ")}
                </p>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <p className="flex items-center gap-2 text-xs text-slate-400" data-testid="chat-thinking">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" aria-hidden="true" />
            Reading the job…
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form className="flex items-center gap-2 px-3 py-3 border-t border-slate-700 shrink-0"
        onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <Input ref={inputRef} data-testid="chat-input" value={draft} disabled={busy}
          onChange={(e) => setDraft(e.target.value)} placeholder="Ask about this job…"
          className="bg-slate-800/50 border-slate-600 text-sm" />
        <Button type="submit" size="sm" data-testid="chat-send" disabled={busy || !draft.trim()}
          className="bg-amber-500 text-slate-950 hover:bg-amber-400 shrink-0">
          <Send className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form>
    </aside>
  );
};
