import type { KeyboardEvent } from 'react';
import type { FinalAttendanceStatus } from '../types/attendance';

const marks = new Map<string, FinalAttendanceStatus>([
 ['p', 'PRESENT'], ['l', 'LATE'], ['a', 'ABSENT'], ['e', 'EXCUSED'],
]);

export const attendanceShortcutKey: Record<FinalAttendanceStatus, string> = {
 PRESENT: 'P', LATE: 'L', ABSENT: 'A', EXCUSED: 'E',
};

export function attendanceShortcut(onMark: (status: FinalAttendanceStatus) => void) {
 return (event: KeyboardEvent<HTMLDivElement>) => {
  if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !event.currentTarget.contains(target) ||
      target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]')) return;
  const status = marks.get(event.key.toLowerCase());
  if (!status) return;
  event.preventDefault();
  event.stopPropagation();
  // Keep keyboard focus on the group as the current student's buttons are disabled.
  event.currentTarget.focus({preventScroll:true});
  onMark(status);
 };
}
