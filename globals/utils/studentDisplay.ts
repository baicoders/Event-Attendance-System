/** Presentation only: internal student IDs must remain lookup and mutation keys. */
export function studentDisplayIdentifier(student: { usn?: string | null; lrn?: string | null }): string {
  return student.usn?.trim() || student.lrn?.trim() || "—";
}
