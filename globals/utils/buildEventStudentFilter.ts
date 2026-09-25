import { Prisma, SchoolLevel, EventCategory } from "@prisma/client";
import { Student } from "../types/students";

// ============================================================================
// UTILITY: Build student filter based on event criteria
// ============================================================================
export const buildEventStudentFilter = (
  event: { category: EventCategory; includedGroups: { slug: string }[] },
): Prisma.StudentWhereInput => {
  const where: Prisma.StudentWhereInput = {};

  // Categories that map to enums remain the same
  if (event.category === "COLLEGE") return { schoolLevel: SchoolLevel.COLLEGE };
  if (event.category === "SHS") return { schoolLevel: SchoolLevel.SHS };
  if (event.category === "ALL") return where;

  // For everything else, we query the 'groups' relation by slug
  const includedSlugs: string[] = event.includedGroups.map((g) => g.slug);

  // Fail closed. A scoped event that has lost every group (its groups were
  // deleted) targets NOBODY, not everybody - returning an unfiltered `where`
  // here would silently widen a department event to the whole school across
  // stats, the absent list, and the scan eligibility gate.
  if (includedSlugs.length === 0) {
    where.id = { in: [] };
    return where;
  }

  where.groups = {
    some: {
      slug: { in: includedSlugs },
    },
  };

  return where;
};

/**
 * Checks if a specific student is eligible to join an event
 * based on the event's category and included groups.
 */
export const isStudentInEvent = (
  student: Student,
  event: { category: EventCategory; includedGroups: { slug: string }[] },
): boolean => {
  const category = event.category;
  if (category === "ALL") return true;
  if (category === "COLLEGE") return student.schoolLevel === "COLLEGE";
  if (category === "SHS") return student.schoolLevel === "SHS";

  const includedSlugs: string[] = event.includedGroups.map((g) => g.slug);

  return student.groups?.some((group) => includedSlugs.includes(group.slug)) ?? false;
};
