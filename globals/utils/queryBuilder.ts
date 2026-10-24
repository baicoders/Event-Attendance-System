import { Prisma } from "@prisma/client";

type StudentQueryFilters = {
  category?: string;
  house?: string;
  department?: string;
  program?: string;
  strand?: string;
  customGroupId?: string;
};

/**
 * Builds a Prisma 'where' object based on provided search filters.
 * Uses an 'AND' array so multiple filters (House + Strand) work together.
 */
export function buildStudentQuery(params: StudentQueryFilters): Prisma.StudentWhereInput {
  const { category, house, department, program, strand, customGroupId } = params;
  const conditions: Prisma.StudentWhereInput[] = [];

  if (customGroupId) {
    conditions.push({
      customMemberships: { some: { groupId: customGroupId, group: { category: "CUSTOM" } } },
    });
  }

  // 1. Filter by House
  if (house) {
    conditions.push({
      groups: { some: { category: "HOUSE", slug: house } },
    });
  }

  // 2. Filter by College/Dept/Program. Always scope to the school level so
  // `?category=COLLEGE` without a subgroup returns college students only, not
  // the entire roster (SHS included).
  if (category === "COLLEGE") {
    conditions.push({ schoolLevel: "COLLEGE" });
    if (department) {
      conditions.push({
        groups: { some: { category: "DEPARTMENT", slug: department } },
      });
    }
    if (program) {
      conditions.push({
        groups: { some: { category: "PROGRAM", slug: program } },
      });
    }
  }

  // 3. Filter by SHS/Strand. Scope to the SHS school level regardless of strand.
  if (category === "SHS") {
    conditions.push({ schoolLevel: "SHS" });
    if (strand) {
      conditions.push({
        groups: { some: { category: "STRAND", slug: strand } },
      });
    }
  }

  // If no conditions, return empty object (fetches all)
  if (conditions.length === 0) return {};

  // Combine all conditions using AND
  return { AND: conditions };
}
