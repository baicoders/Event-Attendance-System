"use client";

import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";

import { Button } from "@/globals/components/shad-cn/button";
import { Calendar } from "@/globals/components/shad-cn/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/globals/components/shad-cn/popover";
import { useState } from "react";

type Props = {
  date?: Date
  onChange: (date: Date) => void;
};

const DatePicker = ({ onChange, date }: Props) => {
  const [open, setOpen] = useState(false);

  const handleDateChange = (newDate: Date | undefined) => {
    if (!newDate) return;
    onChange(newDate);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          data-empty={!date}
          className="h-9 w-full justify-start gap-2 border-slate-300 bg-white text-left text-sm font-medium text-slate-700 data-[empty=true]:text-slate-400"
        >
          <CalendarIcon className="h-4 w-4" />
          {date ? format(date, "EEE, MMM d") : <span>Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="z-[60] w-auto p-0">
        <Calendar
          mode="single"
          selected={date}
          onSelect={handleDateChange}
          required
        />
      </PopoverContent>
    </Popover>
  );
};

export default DatePicker;
