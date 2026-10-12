import { z } from "zod";

const resultSchema = z.object({
  operation: z.enum(["TIME_IN", "TIME_OUT"]),
  visit: z.object({
    id: z.string().min(1), studentId: z.string().min(1), personType: z.enum(["STUDENT", "EMPLOYEE"]),
    timeIn: z.iso.datetime(), timeOut: z.iso.datetime().nullable(),
    student: z.object({ id: z.string(), firstName: z.string(), lastName: z.string(), middleName: z.string().nullable() }),
  }),
});
export type LibraryScanResult = z.infer<typeof resultSchema>;
export function parseLibraryScanResult(value: unknown, studentId: string): LibraryScanResult {
  const result = resultSchema.parse(value);
  if (result.visit.studentId !== studentId || result.visit.student.id !== studentId || (result.operation === "TIME_OUT" && !result.visit.timeOut)) {
    throw new Error("Uncertain scan response");
  }
  return result;
}
