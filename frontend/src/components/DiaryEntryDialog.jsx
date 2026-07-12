import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/DatePicker";
import api, { formatApiErrorDetail } from "@/lib/api";

export const WEATHER_OPTIONS = [
  { value: "sunny", label: "Sunny" },
  { value: "partly-cloudy", label: "Partly Cloudy" },
  { value: "overcast", label: "Overcast" },
  { value: "rain", label: "Rain" },
  { value: "storm", label: "Storm" },
  { value: "windy", label: "Windy" },
  { value: "frost", label: "Frost" },
];

export const weatherLabel = (v) => WEATHER_OPTIONS.find((w) => w.value === v)?.label || v;

const EMPTY = { date: "", weather: "none", temp_c: "", notes: "" };

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1.5 ${className}`}>
    <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">{label}</Label>
    {children}
  </div>
);

export const DiaryEntryDialog = ({ open, onOpenChange, projectId, entry, onSaved }) => {
  const [form, setForm] = useState(EMPTY);
  const [crew, setCrew] = useState([]);
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(entry);
  const fieldCls = "bg-slate-800/50 border-slate-600";

  useEffect(() => {
    if (open) {
      if (entry) {
        setForm({
          date: entry.date || "",
          weather: entry.weather || "none",
          temp_c: entry.temp_c != null ? String(entry.temp_c) : "",
          notes: entry.notes || "",
        });
        setCrew((entry.crew || []).map((c) => ({ trade: c.trade, count: String(c.count) })));
      } else {
        setForm({ ...EMPTY, date: new Date().toISOString().slice(0, 10) });
        setCrew([]);
      }
    }
  }, [open, entry]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setCrewAt = (i, k) => (e) =>
    setCrew((c) => c.map((row, idx) => (idx === i ? { ...row, [k]: e.target.value } : row)));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        date: form.date || null,
        weather: form.weather === "none" ? "" : form.weather,
        temp_c: form.temp_c === "" ? null : parseFloat(form.temp_c),
        crew: crew.filter((c) => c.trade.trim()).map((c) => ({ trade: c.trade, count: parseInt(c.count, 10) || 1 })),
        notes: form.notes,
      };
      isEdit
        ? await api.put(`/diary/${entry.id}`, payload)
        : await api.post(`/projects/${projectId}/diary`, payload);
      toast.success(isEdit ? "Diary entry updated" : "Diary entry added");
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Failed to save diary entry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto bg-card border-slate-700" data-testid="diary-entry-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl font-bold text-slate-100">
            {isEdit ? "Edit Diary Entry" : "Add Diary Entry"}
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">
            Record conditions, crew on site and progress notes for the daily site diary.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 mt-2">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date *">
              <DatePicker value={form.date} onChange={(v) => setForm((f) => ({ ...f, date: v }))} testId="diary-form-date" />
            </Field>
            <Field label="Weather">
              <Select value={form.weather} onValueChange={(v) => setForm((f) => ({ ...f, weather: v }))}>
                <SelectTrigger data-testid="diary-form-weather" className={fieldCls}><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent className="bg-card border-slate-700">
                  <SelectItem value="none">Not recorded</SelectItem>
                  {WEATHER_OPTIONS.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Temp °C">
              <Input data-testid="diary-form-temp" type="number" step="0.5" className={fieldCls}
                value={form.temp_c} onChange={set("temp_c")} placeholder="18" />
            </Field>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Crew on site</Label>
            {crew.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input data-testid={`diary-crew-trade-${i}`} className={`${fieldCls} flex-1`} placeholder="e.g. Carpenters"
                  value={c.trade} onChange={setCrewAt(i, "trade")} />
                <Input data-testid={`diary-crew-count-${i}`} type="number" min="1" className={`${fieldCls} w-20`}
                  value={c.count} onChange={setCrewAt(i, "count")} />
                <button type="button" data-testid={`diary-crew-remove-${i}`}
                  onClick={() => setCrew((rows) => rows.filter((_, idx) => idx !== i))}
                  className="p-1.5 rounded-md text-slate-500 hover:text-red-400 transition-colors duration-200">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
            <button type="button" data-testid="diary-crew-add" onClick={() => setCrew((rows) => [...rows, { trade: "", count: "1" }])}
              className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors duration-200">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add crew
            </button>
          </div>

          <Field label="Notes">
            <Textarea data-testid="diary-form-notes" className={`${fieldCls} min-h-[100px]`}
              value={form.notes} onChange={set("notes")} placeholder="Work performed, deliveries, inspections, delays…" />
          </Field>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" data-testid="diary-form-cancel" onClick={() => onOpenChange(false)}
              className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-800">
              Cancel
            </Button>
            <Button type="submit" data-testid="diary-form-save" disabled={busy}
              className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : isEdit ? "Save Changes" : "Add Entry"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
