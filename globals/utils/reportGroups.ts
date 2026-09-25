import type { EventCategory, YearLevel } from "@prisma/client";

import { attendanceRate, type AttendanceOutcome } from "./attendance";

export const GROUP_DIMENSIONS = ["DEPARTMENT", "PROGRAM", "STRAND", "HOUSE", "SECTION", "YEAR"] as const;
export type GroupDimension = (typeof GROUP_DIMENSIONS)[number];

type Membership = { id: string; name: string; slug: string; category: EventCategory };
export type GroupStudent = { yearLevel: YearLevel; groups: readonly Membership[] };
export type GroupBucket = { key: string; id: string | null; slug: string | null; label: string };
export type GroupSummary = GroupBucket & {
  eligible: number;
  present: number;
  late: number;
  absent: number;
  attended: number;
  rate: number | null;
};

export function bucketForStudent(student: GroupStudent, dimension: GroupDimension): GroupBucket {
  if (dimension === "YEAR") {
    return { key: `y:${student.yearLevel}`, id: null, slug: null, label: student.yearLevel.replace("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) };
  }
  const matches = [...new Map(student.groups.filter((group) => group.category === dimension).map((group) => [group.id, group])).values()];
  if (matches.length === 0) return { key: "none", id: null, slug: null, label: dimension === "SECTION" ? "Ungrouped (no section)" : "Ungrouped" };
  if (matches.length > 1) return { key: "multiple", id: null, slug: null, label: `Multiple ${dimension.toLowerCase()} assignments` };
  const group = matches[0];
  return { key: `g:${group.id}`, id: group.id, slug: group.slug, label: group.name };
}

export function summarizeGroups(
  entries: readonly { student: GroupStudent; outcome: AttendanceOutcome }[],
  dimension: GroupDimension,
): GroupSummary[] {
  const buckets = new Map<string, GroupSummary>();
  for (const { student, outcome } of entries) {
    const identity = bucketForStudent(student, dimension);
    const bucket = buckets.get(identity.key) ?? { ...identity, eligible: 0, present: 0, late: 0, absent: 0, attended: 0, rate: null };
    bucket.eligible += 1;
    bucket[outcome.toLowerCase() as "present" | "late" | "absent"] += 1;
    if (outcome !== "ABSENT") bucket.attended += 1;
    buckets.set(identity.key, bucket);
  }
  return [...buckets.values()].map((bucket) => ({ ...bucket, rate: attendanceRate(bucket.attended, bucket.eligible) })).sort((a, b) => {
    const order = (key: string) => key === "none" ? 1 : key === "multiple" ? 2 : 0;
    return order(a.key) - order(b.key) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key);
  });
}
