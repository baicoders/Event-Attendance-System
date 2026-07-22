import { EventContentArg } from "@fullcalendar/core";
import React from "react";

const CalendarEventCard = ({ arg }: { arg: EventContentArg }) => {
  // Clean up trailing dash for drafts
  const cleanTimeText = arg.timeText.replace(/\s*-\s*$/, "");
  const isAllDay = arg.event.allDay;
  const isPast = arg.isPast;

  // Past events keep their full, solid status color but sit under a single,
  // statically discoverable opacity class on the container. Applying opacity to
  // the whole card dims background and text together, so contrast is preserved
  // and the text stays readable - unlike the old runtime `${color}/${opacity}`
  // strings (e.g. `bg-emerald-500/50`, `text-white/40`), which Tailwind can't
  // discover and so never generated, leaving past events as bare colored bars
  // with invisible text.
  const pastClass = isPast ? "opacity-70" : "";

  /** Shared styles */
  const status =
    arg.event.id === "draft"
      ? "DRAFT"
      : (arg.event.extendedProps?.status as string | undefined) ?? "APPROVED";
  const statusColors: Record<
    string,
    {
      bg: string;
      bar: string;
      accent: string;
      textMain: string;
      textSub: string;
      monthBg: string;
      monthBorder: string;
      monthText: string;
      monthTime: string;
    }
  > = {
    DRAFT: {
      bg: "bg-orange-500",
      bar: "bg-orange-700",
      accent: "bg-orange-600",
      textMain: "text-white",
      textSub: "text-orange-100",
      monthBg: "bg-orange-50",
      monthBorder: "border-orange-200",
      monthText: "text-orange-900",
      monthTime: "text-orange-700",
    },
    PENDING: {
      bg: "bg-sky-500",
      bar: "bg-sky-700",
      accent: "bg-sky-600",
      textMain: "text-white",
      textSub: "text-sky-100",
      monthBg: "bg-sky-50",
      monthBorder: "border-sky-200",
      monthText: "text-sky-900",
      monthTime: "text-sky-700",
    },
    APPROVED: {
      bg: "bg-emerald-500",
      bar: "bg-emerald-700",
      accent: "bg-emerald-600",
      textMain: "text-white",
      textSub: "text-emerald-100",
      monthBg: "bg-emerald-50",
      monthBorder: "border-emerald-200",
      monthText: "text-emerald-900",
      monthTime: "text-emerald-700",
    },
    REJECTED: {
      bg: "bg-rose-500",
      bar: "bg-rose-700",
      accent: "bg-rose-600",
      textMain: "text-white",
      textSub: "text-rose-100",
      monthBg: "bg-rose-50",
      monthBorder: "border-rose-200",
      monthText: "text-rose-900",
      monthTime: "text-rose-700",
    },
  };

  const colors = statusColors[status] ?? statusColors.APPROVED;

  /** All-day events */
  if (isAllDay) {
    return (
      <div
        className={`flex h-full w-full flex-row overflow-hidden ${colors.bg} ${pastClass}`}
      >
        <div className={`${colors.bar} w-1.5 shrink-0`} />
        <div className="flex flex-col justify-center items-start px-1 py-0.5">
          <p className={`font-semibold text-xs truncate ${colors.textMain}`}>
            {arg.event.title}
          </p>
        </div>
      </div>
    );
  }

  /** Month view */
  if (arg.view.type === "dayGridMonth") {
    return (
      <div
        className={`flex w-full flex-1 flex-row items-center gap-1 overflow-hidden rounded-md border px-1.5 py-0.5 transition-colors ${colors.monthBg} ${colors.monthBorder} ${pastClass}`}
      >
        {/* Bullet indicator */}
        <div className={`size-2 rounded-full shrink-0 ${colors.bar}`} />

        {/* Text content */}
        <div className="flex-1 flex flex-row gap-1 items-center min-w-0">
          {cleanTimeText && (
            <p
              className={`text-[11px] whitespace-nowrap font-semibold ${colors.monthTime}`}
            >
              {cleanTimeText}
            </p>
          )}
          <p className={`truncate text-[11px] font-semibold ${colors.monthText}`}>
            {arg.event.title}
          </p>
        </div>
      </div>
    );
  }

  /** TimeGrid / Week / Day views */
  return (
    <div
      className={`flex w-full h-full flex-row justify-start items-start overflow-hidden ${colors.bg} ${pastClass}`}
    >
      <div className={`${colors.bar} h-full w-1.5 shrink-0`} />

      <div className="flex flex-1 flex-col px-1 py-0.5 h-full overflow-hidden">
        {/* Title */}
        <p
          className={`font-semibold text-xs leading-tight line-clamp-2 overflow-hidden ${colors.textMain}`}
        >
          {arg.event.title}
        </p>

        {/* Time */}
        {cleanTimeText && (
          <p className={`text-[10px] font-medium truncate ${colors.textSub}`}>
            {cleanTimeText}
          </p>
        )}
      </div>
    </div>
  );
};

export default CalendarEventCard;
