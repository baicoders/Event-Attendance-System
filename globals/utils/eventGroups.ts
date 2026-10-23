import { EventCategory } from "@prisma/client";
import { prisma } from "@/globals/libs/prisma";

// Categories that target specific groups. The global ones (ALL/COLLEGE/SHS)
// scope by school level, not by an explicit group selection.
const SCOPED_CATEGORIES: EventCategory[] = [
  "CUSTOM",
  "DEPARTMENT",
  "HOUSE",
  "STRAND",
  "PROGRAM",
  "SECTION",
  "YEAR",
];

/**
 * Server-side check that an event's selected group ids are real and belong to
 * the event's category. Prevents a crafted request from scoping an event to
 * groups of a different category. Returns an error message, or null when valid.
 */
export async function validateEventGroupIds(
  category: EventCategory,
  groupIds: string[] | null | undefined,
): Promise<string | null> {
  if (!SCOPED_CATEGORIES.includes(category)) {
    return null;
  }

  const ids = groupIds ?? [];
  if (ids.length === 0) {
    return "At least one group must be selected for this category.";
  }

  const groups = await prisma.group.findMany({
    where: { id: { in: ids } },
    select: { id: true, category: true },
  });

  if (groups.length !== new Set(ids).size) {
    return "One or more selected groups do not exist.";
  }

  const mismatched = groups.find((g) => g.category !== category);
  if (mismatched) {
    return `Selected group does not belong to the ${category.toLowerCase()} category.`;
  }

  return null;
}
