import { createHash } from "crypto";
import type { EventCategory } from "@prisma/client";

type GroupRef = {
  id: string;
  slug: string;
  category: EventCategory;
};

type StudentRef = {
  id: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  schoolLevel: string;
  yearLevel: string;
  createdAt: Date;
  updatedAt: Date;
  groups: GroupRef[];
};

/**
 * Tagged edit-content projection for one student, including raw group
 * memberships. Intentionally excludes cosmetic Group names/timestamps so a
 * rename does not change the edit version — renames are tracked separately
 * via {@link reviewFingerprint}.
 *
 * Sorted group IDs keep the projection deterministic regardless of join order.
 */
export function projectStudentContent(student: StudentRef) {
  const groupIds = [...student.groups]
    .map((g) => ({ id: g.id, slug: g.slug, category: g.category }))
    .sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : a.slug < b.slug ? -1 : 1,
    );
  return {
    v: 1 as const,
    id: student.id,
    createdAt: student.createdAt.toISOString(),
    updatedAt: student.updatedAt.toISOString(),
    firstName: student.firstName,
    lastName: student.lastName,
    middleName: student.middleName,
    schoolLevel: student.schoolLevel,
    yearLevel: student.yearLevel,
    groups: groupIds,
  };
}

export type StudentContentProjection = ReturnType<typeof projectStudentContent>;

/** Deterministic version string for a projected student. */
export function contentVersion(projection: StudentContentProjection): string {
  return createHash("sha256")
    .update(JSON.stringify(projection))
    .digest("hex");
}

/**
 * Review fingerprint for the labels shown in a bulk preview. Binds the
 * source/target display names so a group rename invalidates the review
 * without silently redefining the edit-version contract.
 */
export function reviewFingerprint(input: {
  targetId: string;
  targetSlug: string;
  targetName: string;
  targetCategory: string;
  beforeLabels: Array<{ id: string; slug: string | null; name: string | null }>;
}): string {
  const sorted = [...input.beforeLabels].sort((a, b) =>
    a.id < b.id ? -1 : 1,
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        v: 1,
        targetId: input.targetId,
        targetSlug: input.targetSlug,
        targetName: input.targetName,
        targetCategory: input.targetCategory,
        before: sorted,
      }),
    )
    .digest("hex");
}
