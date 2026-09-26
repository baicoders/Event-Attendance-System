import type { PrismaClient } from "@prisma/client";
import type { StudentFormValues } from "@/globals/schemas/studentSchema";
import { takeRosterExclusiveLock } from "./pgLocks";
import { flattenStudentGroups } from "./students";
import { studentEditVersion } from "./studentDetail";
import { hasAmbiguousStudentGroups } from "./studentGroupReview";
import { validateStudentGroupSlugs } from "./studentGroups";

export type StudentEditRequest = { expectedVersion: string; student: StudentFormValues; principalId?: string };

export async function updateStudentDetail(db: PrismaClient, id: string, request: StudentEditRequest) {
  return db.$transaction(async tx => {
    // Single-student roster edit freezes eligibility (exclusive form).
    await takeRosterExclusiveLock(tx);
    if (request.principalId) {
      const principal = await tx.user.findUnique({ where: { id: request.principalId }, select: { status: true } });
      if (principal?.status !== "ACTIVE") return { kind: "forbidden" as const };
    }
    const current = await tx.student.findUnique({ where: { id }, include: { groups: true } });
    if (!current) return { kind: "not-found" as const };
    if (studentEditVersion(current) !== request.expectedVersion) return { kind: "conflict" as const };
    if (hasAmbiguousStudentGroups(current.groups)) return { kind: "group-review" as const };

    const form = request.student;
    const resolution = await validateStudentGroupSlugs([form], tx);
    if (!resolution.ok) return { kind: "invalid-groups" as const, message: resolution.error };
    const ids = [form.section, form.house, form.department, form.program, form.strand]
      .filter((slug): slug is string => !!slug)
      .map(slug => resolution.slugToId.get(slug)!);
    const priorIds = current.groups.map(group => group.id).sort();
    const sameGroups = JSON.stringify(priorIds) === JSON.stringify([...ids].sort());
    const sameScalars = current.firstName === form.firstName && current.lastName === form.lastName &&
      (current.middleName ?? "") === (form.middleName ?? "") &&
      current.schoolLevel === form.schoolLevel && current.yearLevel === form.yearLevel;
    if (sameGroups && sameScalars) {
      return { kind: "ok" as const, changed: false, student: { ...flattenStudentGroups(current), editVersion: studentEditVersion(current) } };
    }
    const updated = await tx.student.update({ where: { id }, data: {
      firstName: form.firstName, lastName: form.lastName, middleName: form.middleName || null,
      schoolLevel: form.schoolLevel, yearLevel: form.yearLevel,
      groups: { set: ids.map(groupId => ({ id: groupId })) },
    }, include: { groups: true } });
    return { kind: "ok" as const, changed: true, student: { ...flattenStudentGroups(updated), editVersion: studentEditVersion(updated) } };
  }, { timeout: 5_000, maxWait: 5_000 });
}
