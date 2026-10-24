import type { Student } from "@/globals/types/students";

export type QRIdentifierType = "USN" | "LRN";
type QRStudent = Pick<Student, "id" | "usn" | "lrn">;
type QRIdentifier = { type: QRIdentifierType | "Student ID"; value: string };

export function studentQRIdentifiers(student: QRStudent): QRIdentifier[] {
  const identifiers: QRIdentifier[] = [];
  if (student.usn) identifiers.push({ type: "USN", value: student.usn });
  if (student.lrn) identifiers.push({ type: "LRN", value: student.lrn });
  return identifiers.length ? identifiers : [{ type: "Student ID", value: student.id }];
}

/** Prefer the requested external identifier, falling back only when unavailable. */
export function resolveQRIdentifier(student: QRStudent, preferred: QRIdentifierType = "USN"): QRIdentifier {
  const identifiers = studentQRIdentifiers(student);
  return identifiers.find(identifier => identifier.type === preferred) ?? identifiers[0];
}
