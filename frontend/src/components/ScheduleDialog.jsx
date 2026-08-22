import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DatePicker } from "@/components/DatePicker";
import api, { formatApiErrorDetail } from "@/lib/api";

export const ScheduleDialog = ({ open, onOpenChange, row, onSaved }) => {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !row) return;
    setStart(row.scheduled_start || "");
    setEnd(row.scheduled_end || "");
  }, [open, row]);

  const save = async () => {
    if (end && start && end < start) {
      toast.error("The finish date can't be before the start date.");
      return;
    }
    setBusy(true);
    try {
      await api.put(`/packages/${row.package_id}`, {
        scheduled_start: start || null,
        scheduled_end: end || null,
      });
      toast.success(start ? `${row.title} booked for site` : "Dates cleared");
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not save the dates.");
    } finally {
      setBusy(false);
    }
  };

  if (!row) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-slate-700" data-testid="schedule-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl font-bold text-slate-100 flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-amber-400" aria-hidden="true" /> Book {row.title}
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">
            {row.trade_name ? `When is ${row.trade_name} on site?` : "When is this trade on site?"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Start</Label>
              <DatePicker value={start} onChange={setStart} testId="schedule-start" placeholder="Start date" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Finish</Label>
              <DatePicker value={end} onChange={setEnd} testId="schedule-end" placeholder="Finish date" />
            </div>
          </div>
          <div className="flex justify-between gap-3 pt-1">
            <Button type="button" variant="outline" data-testid="schedule-clear"
              onClick={() => { setStart(""); setEnd(""); }}
              className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-800">
              Clear
            </Button>
            <div className="flex gap-3">
              <Button type="button" variant="outline" data-testid="schedule-cancel" onClick={() => onOpenChange(false)}
                className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-800">
                Cancel
              </Button>
              <Button data-testid="schedule-save" disabled={busy} onClick={save}
                className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Save Dates"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
