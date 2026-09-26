import { z } from "zod";
import { ApiError } from "@/globals/utils/api";
import type { AttendanceProgressResponse } from "@/globals/utils/attendanceProgressRead";

const counts = z.object({
  eligible: z.number().int().nonnegative(), checkedIn: z.number().int().nonnegative(),
  notYet: z.number().int().nonnegative(), rate: z.number().finite().nullable(),
});
const row = z.object({
  studentId: z.string(), fullName: z.string(), schoolLevel: z.string(), yearLevel: z.string(),
  sectionLabel: z.string(), checkedIn: z.boolean(), timein: z.string().nullable(),
  timeout: z.string().nullable(), recordNeedsReview: z.boolean(),
});
const response = z.object({
  event: z.object({ id: z.string(), title: z.string(), status: z.literal("APPROVED"), isTimeout: z.boolean() }),
  evaluatedAt: z.string(), audienceSignature: z.string(), populationBasis: z.literal("CURRENT_ROSTER"),
  groupBy: z.enum(["SECTION", "DEPARTMENT", "PROGRAM", "STRAND", "HOUSE", "YEAR"]),
  totals: counts, diagnostics: z.object({ recordsWithoutTimeIn: z.number().int().nonnegative() }),
  breakdown: z.array(counts.extend({ bucketKey: z.string(), label: z.string(), groupId: z.string().optional(), slug: z.string().optional() })),
  detail: z.object({
    bucketKey: z.string(), bucketLabel: z.string(), status: z.enum(["ALL", "NOT_YET", "CHECKED_IN"]),
    query: z.string(), bucketTotals: counts, matchedCount: z.number().int().nonnegative(),
    page: z.number().int().positive(), pageSize: z.number().int().positive(), rows: z.array(row),
  }).nullable(),
});

export function validateProgressResponse(payload: unknown): AttendanceProgressResponse {
  const parsed = response.safeParse(payload);
  if (!parsed.success) throw new ApiError("Invalid progress response. Try again.", 502, "INVALID_PROGRESS_RESPONSE");
  return parsed.data as AttendanceProgressResponse;
}
