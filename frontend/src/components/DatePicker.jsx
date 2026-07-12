import { format } from "date-fns";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const DatePicker = ({ value, onChange, placeholder = "Pick a date", testId }) => {
  const date = value ? new Date(`${value}T00:00:00`) : undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" data-testid={testId}
          className="w-full justify-start gap-2 bg-slate-800/50 border-slate-600 font-normal text-sm text-slate-200 hover:bg-slate-700 hover:text-slate-100">
          <CalendarIcon className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
          {date ? format(date, "d MMM yyyy") : <span className="text-slate-500">{placeholder}</span>}
          {value && (
            <span
              role="button"
              tabIndex={0}
              data-testid={testId ? `${testId}-clear` : undefined}
              className="ml-auto text-slate-500 hover:text-red-400"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onChange(""); }}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 bg-card border-slate-700" align="start">
        <Calendar mode="single" selected={date} onSelect={(d) => onChange(d ? format(d, "yyyy-MM-dd") : "")} />
      </PopoverContent>
    </Popover>
  );
};
