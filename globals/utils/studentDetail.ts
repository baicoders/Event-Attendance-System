import { createHash } from "node:crypto";

type VersionGroup = { id: string; category: string; slug: string };
type VersionStudent = {
  id: string; createdAt: Date | string; updatedAt: Date | string;
  firstName: string; lastName: string; middleName: string | null;
  schoolLevel: string; yearLevel: string; groups: VersionGroup[];
};

/** Content token for one authoritative student/group read. */
export function studentEditVersion(student: VersionStudent): string {
  const projection = ["student-edit-v1", student.id,
    new Date(student.createdAt).toISOString(), new Date(student.updatedAt).toISOString(),
    student.firstName, student.lastName, student.middleName, student.schoolLevel,
    student.yearLevel,
    student.groups.map(group => [group.id, group.category, group.slug])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))];
  return createHash("sha256").update(JSON.stringify(projection)).digest("hex");
}
