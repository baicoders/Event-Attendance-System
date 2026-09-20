import { Event } from "@/globals/types/events";

export interface DraftEvent {
  id: string;
  start: Date;
  end: Date;
  backgroundColor: string;
  editable: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
}

export type CalendarView =
  | "dayGridMonth"
  | "timeGridWeek"
  | "timeGridDay";

export interface CalendarProps {
  onSelectDate: (start: Date, end: Date) => void;
  isDrawerOpen: boolean;
  onEditEvent?: (event: Event) => void;
  /** Initial view/date, restored from the URL. */
  initialView?: CalendarView;
  initialDate?: string;
  /** Fired when the user changes the visible view or date (not on mount). */
  onViewDateChange?: (view: CalendarView, date: string) => void;
}