import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/globals/components/shad-cn/collapsible";
import { cn } from "@/globals/libs/shad-cn";
import DatePicker from "@/features/calendar/components/DatePicker";
import TimeSelector from "@/features/calendar/components/TimeSelector";
import { format } from "date-fns";
import { CalendarClock, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  label: string;
  date?: Date;
  onDateTimeChange: (date: Date) => void;
  allDay: boolean;
};

type Time = {
  hour: number;
  minute: number;
  second: number;
  period: "AM" | "PM";
};

const DEFAULT_TIME: Time = { hour: 9, minute: 0, second: 0, period: "AM" };

/**
 * Helper to combine date and time into a single Date object
 */
function buildDateTime(date: Date, time: Time, allDay: boolean): Date {
  if (allDay)
    return new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    );

  const hour =
    time.period === "PM" && time.hour !== 12
      ? time.hour + 12
      : time.period === "AM" && time.hour === 12
      ? 0
      : time.hour;

  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hour,
    time.minute,
    time.second
  );
}

function getTimeFromDate(date: Date): Time {
  return {
    hour: date.getHours() % 12 || 12,
    minute: date.getMinutes(),
    second: date.getSeconds(),
    period: date.getHours() >= 12 ? "PM" : "AM",
  };
}

const DateTimeForm = ({
  label,
  date,
  onDateTimeChange,
  allDay,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(date);
  const [selectedTime, setSelectedTime] = useState<Time>(date ? getTimeFromDate(date) : DEFAULT_TIME);

  useEffect(() => {
    setSelectedDate(date);
    setSelectedTime(date ? getTimeFromDate(date) : DEFAULT_TIME);
  }, [date]);

  const fullDateTime = selectedDate
    ? buildDateTime(selectedDate, selectedTime, allDay)
    : undefined;
  const formattedDateTime = fullDateTime
    ? format(fullDateTime, allDay ? "EEE, MMM d, yyyy" : "EEE, MMM d, yyyy h:mm a")
    : "Choose date";

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-xl border border-slate-200 bg-white"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
        >
          <div className="flex min-w-0 items-center gap-2">
            <CalendarClock className="size-4 shrink-0 text-slate-500" />
            <p className="text-sm font-medium text-slate-800">{label}</p>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm text-slate-600">{formattedDateTime}</p>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-slate-500 transition-transform",
                open ? "rotate-180" : ""
              )}
            />
          </div>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent asChild>
        <div className="grid gap-2 border-t border-slate-200 px-3 py-3 sm:grid-cols-[auto_1fr] sm:items-center">
          <DatePicker
            date={fullDateTime}
            onChange={(date) => {
              setSelectedDate(date);
              onDateTimeChange(buildDateTime(date, selectedTime, allDay));
            }}
          />
          {allDay ? (
            <p className="text-xs text-slate-500 sm:justify-self-end">
              All-day events use 12:00 AM.
            </p>
          ) : selectedDate ? (
            <TimeSelector
              time={selectedTime}
              onChange={(time) => {
                setSelectedTime(time);
                onDateTimeChange(buildDateTime(selectedDate, time, allDay));
              }}
              disabled={false}
            />
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default DateTimeForm;
