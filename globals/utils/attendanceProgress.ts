import { attendanceRate, hasRecordedTimeIn } from "./attendance";
import type { ProgressQuery } from "./attendanceProgressQuery";

export type ProgressGroup = { id: string; name: string; slug: string; category: string };
export type ProgressStudent = {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  schoolLevel: string;
  yearLevel: string;
  groups: ProgressGroup[];
  records: { timein: Date | null; timeout: Date | null }[];
};
export type ProgressCounts = { eligible: number; checkedIn: number; notYet: number; rate: number | null };
export type ProgressBucket = ProgressCounts & { bucketKey: string; label: string; groupId?: string; slug?: string };
export type ProgressRow = {
  studentId: string; fullName: string; schoolLevel: string; yearLevel: string; sectionLabel: string;
  checkedIn: boolean; timein: string | null; timeout: string | null; recordNeedsReview: boolean;
};
export type ProgressAggregate = {
  totals: ProgressCounts;
  diagnostics: { recordsWithoutTimeIn: number };
  breakdown: ProgressBucket[];
  detail: null | {
    bucketKey: string; bucketLabel: string; status: ProgressQuery["status"]; query: string;
    bucketTotals: ProgressCounts; matchedCount: number; page: number; pageSize: number; rows: ProgressRow[];
  };
};

const yearLabels: Record<string, string> = {
  YEAR_1: "Year 1", YEAR_2: "Year 2", YEAR_3: "Year 3", YEAR_4: "Year 4",
  GRADE_11: "Grade 11", GRADE_12: "Grade 12",
};

function counts(students: ProgressStudent[]): ProgressCounts {
  const checkedIn = students.filter((student) => hasRecordedTimeIn(student.records[0])).length;
  return { eligible: students.length, checkedIn, notYet: students.length - checkedIn, rate: attendanceRate(checkedIn, students.length) };
}

function bucketOf(student: ProgressStudent, groupBy: ProgressQuery["groupBy"]): string {
  if (groupBy === "YEAR") return `y:${student.yearLevel}`;
  const groups = new Set(student.groups.filter((group) => group.category === groupBy).map((group) => group.id));
  if (groups.size === 0) return "none";
  if (groups.size > 1) return "multiple";
  return `g:${[...groups][0]}`;
}

function bucketLabel(key: string, groupBy: ProgressQuery["groupBy"], group?: ProgressGroup): string {
  if (key === "all") return "All eligible students";
  if (key === "none") return `No ${groupBy.toLowerCase()} / not applicable`;
  if (key === "multiple") return `Multiple ${groupBy.toLowerCase()} assignments`;
  if (key.startsWith("y:")) return yearLabels[key.slice(2)] ?? key.slice(2);
  return group?.name ?? "Unknown group";
}

export function buildAttendanceProgress({ students, query, selectedGroup }: {
  students: ProgressStudent[]; query: ProgressQuery; selectedGroup: ProgressGroup | null;
}): ProgressAggregate {
  const grouped = new Map<string, ProgressStudent[]>();
  const groupById = new Map<string, ProgressGroup>();
  for (const student of students) {
    for (const group of student.groups) groupById.set(group.id, group);
    const key = bucketOf(student, query.groupBy);
    const bucket = grouped.get(key) ?? [];
    bucket.push(student);
    grouped.set(key, bucket);
  }
  const keys = [...grouped.keys()].sort((a, b) => {
    const order = (key: string) => key === "multiple" ? 1 : key === "none" ? 2 : 0;
    return order(a) - order(b) || bucketLabel(a, query.groupBy, groupById.get(a.slice(2))).localeCompare(bucketLabel(b, query.groupBy, groupById.get(b.slice(2)))) || a.localeCompare(b);
  });
  const breakdown = keys.map((key): ProgressBucket => {
    const group = key.startsWith("g:") ? groupById.get(key.slice(2)) : undefined;
    return { bucketKey: key, label: bucketLabel(key, query.groupBy, group),
      ...(group ? { groupId: group.id, slug: group.slug } : {}), ...counts(grouped.get(key) ?? []) };
  });
  const totals = counts(students);
  const diagnostics = { recordsWithoutTimeIn: students.filter((student) => student.records.length > 0 && student.records[0].timein == null).length };
  if (!query.includeRows) return { totals, diagnostics, breakdown, detail: null };

  const chosen = query.bucket === "all" ? students : grouped.get(query.bucket) ?? [];
  const chosenGroup = query.bucket.startsWith("g:") ? selectedGroup : null;
  const bucketTotals = counts(chosen);
  const search = query.q.toLocaleLowerCase();
  const matched = chosen.filter((student) => {
    const checkedIn = hasRecordedTimeIn(student.records[0]);
    if (query.status === "NOT_YET" && checkedIn) return false;
    if (query.status === "CHECKED_IN" && !checkedIn) return false;
    const firstLast = `${student.firstName} ${student.middleName ?? ""} ${student.lastName}`.replace(/\s+/g, " ");
    const lastFirst = `${student.lastName}, ${student.firstName} ${student.middleName ?? ""}`.replace(/\s+/g, " ");
    return !search || student.id.toLocaleLowerCase().includes(search) ||
      firstLast.toLocaleLowerCase().includes(search) || lastFirst.toLocaleLowerCase().includes(search);
  }).sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) ||
    (a.middleName ?? "").localeCompare(b.middleName ?? "") || a.id.localeCompare(b.id));
  const page = Math.min(query.page, Math.max(1, Math.ceil(matched.length / query.pageSize)));
  const rows = matched.slice((page - 1) * query.pageSize, page * query.pageSize).map((student): ProgressRow => {
    const sections = student.groups.filter((group) => group.category === "SECTION");
    const record = student.records[0];
    return {
      studentId: student.id,
      fullName: `${student.lastName}, ${[student.firstName, student.middleName].filter(Boolean).join(" ")}`,
      schoolLevel: student.schoolLevel, yearLevel: student.yearLevel,
      sectionLabel: sections.length === 0 ? "No section" : sections.length > 1 ? "Multiple sections" : sections[0].name,
      checkedIn: hasRecordedTimeIn(record), timein: record?.timein?.toISOString() ?? null,
      timeout: record?.timeout?.toISOString() ?? null, recordNeedsReview: !!record && record.timein == null,
    };
  });
  return { totals, diagnostics, breakdown, detail: {
    bucketKey: query.bucket,
    bucketLabel: bucketLabel(query.bucket, query.groupBy, chosenGroup ?? undefined),
    status: query.status, query: query.q, bucketTotals, matchedCount: matched.length,
    page, pageSize: query.pageSize, rows,
  } };
}
