import { useCallback, useEffect, useState } from "react";
import { DateSelectArg } from "@fullcalendar/core";
import { DraftEvent } from "@/features/calendar/types/calendar";
import {
  createDraftEvent,
  isRangeWhollyPast,
} from "@/features/calendar/utils/calendar";
import { CALENDAR_CONFIG } from "@/features/calendar/constants/calendarConfig";
import { toastWarning } from "@/globals/components/shared/toasts";

export const useDraftEvent = (
  isDrawerOpen: boolean,
  onSelectDate: (start: Date, end: Date) => void
) => {
  const [draftEvent, setDraftEvent] = useState<DraftEvent | null>(null);

  useEffect(() => {
    if (!isDrawerOpen) {
      setDraftEvent(null);
    }
  }, [isDrawerOpen]);

  const handleSelectDate = useCallback(
    (info: DateSelectArg) => {
      const start = info.start;

      // Block creating an event in a slot that is entirely in the past. A
      // selection that includes or extends past "now" (the rest of today, or
      // any future time) still opens the drawer. This replaces the old
      // validRange restriction, which enforced the same rule by hiding the
      // past outright and thus prevented viewing history.
      if (isRangeWhollyPast(info.start, info.end)) {
        info.view.calendar.unselect();
        toastWarning(
          "Can't schedule in the past",
          "Pick a date and time from now onward."
        );
        return;
      }

      let end: Date;
      if (!info.allDay) {
        // Timed selection (week/day views): keep the exact selected duration
        end = info.end;
      } else {
        // All-day selection: FullCalendar's end is exclusive (midnight after
        // the last selected day). Time-based math, not day-of-month, so
        // month boundaries work.
        const isSingleDay =
          info.end.getTime() - info.start.getTime() <=
          CALENDAR_CONFIG.MILLISECONDS_PER_DAY;
        end = isSingleDay
          ? new Date(start.getTime() + 60 * 60 * 1000) // default 1-hour slot
          : new Date(
              info.end.getTime() - CALENDAR_CONFIG.MILLISECONDS_PER_DAY
            );
      }

      setDraftEvent(createDraftEvent(start, info.end));
      onSelectDate(start, end);
    },
    [onSelectDate]
  );

  return { draftEvent, setDraftEvent, handleSelectDate };
};