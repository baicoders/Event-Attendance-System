import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/globals/libs/prisma";
import type { AudiencePreviewInput } from "@/globals/schemas/audiencePreview";
import type { AudiencePreview } from "@/globals/types/audiencePreview";
import { buildEventStudentFilter } from "./buildEventStudentFilter";

const GLOBAL_CATEGORIES = new Set(["ALL", "COLLEGE", "SHS"]);

export class AudienceScopeError extends Error {}

/** Resolve the same predicate used by attendance and reports for an unsaved scope. */
export async function previewAudience(input: AudiencePreviewInput): Promise<AudiencePreview> {
  const ids = GLOBAL_CATEGORIES.has(input.category) ? [] : input.includedGroups;
  const groups = ids.length
    ? await prisma.group.findMany({
        where: { id: { in: ids }, category: input.category },
        select: { id: true, slug: true },
      })
    : [];

  // A group deleted between initial validation and this lookup must not turn
  // the scope into an apparently valid empty audience.
  if (groups.length !== ids.length) {
    throw new AudienceScopeError("Selected groups changed. Refresh the event form and try again.");
  }

  const where = buildEventStudentFilter({ category: input.category, includedGroups: groups });
  const searchWhere: Prisma.StudentWhereInput = input.search
    ? { AND: [where, { OR: [
        { id: { contains: input.search } },
        { firstName: { contains: input.search } },
        { lastName: { contains: input.search } },
      ] }] }
    : where;

  const [totalEligible, searchMatches, students] = await prisma.$transaction(async (tx) => {
    const total = await tx.student.count({ where });
    const matches = input.search ? await tx.student.count({ where: searchWhere }) : total;
    if (!input.includeRoster) return [total, matches, []] as const;
    const page = await tx.student.findMany({
      where: searchWhere,
      select: {
        id: true, firstName: true, lastName: true, schoolLevel: true,
        yearLevel: true,
        groups: { where: { category: "SECTION" }, select: { name: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    });
    return [total, matches, page] as const;
  });

  return {
    scopeSignature: JSON.stringify([input.category, ids]),
    evaluatedAt: new Date().toISOString(),
    totalEligible,
    searchMatches,
    page: input.page,
    pageSize: input.pageSize,
    students: students.map(({ groups, ...student }) => ({
      ...student,
      section: groups[0]?.name ?? null,
    })),
    ...(input.category === "YEAR"
      ? { limitation: "YEAR groups currently have no roster mapping. Year level is shown for reference but does not determine eligibility." }
      : {}),
  };
}
