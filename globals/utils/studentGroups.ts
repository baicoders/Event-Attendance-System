import { prisma } from "@/globals/libs/prisma";
import type { Prisma } from "@prisma/client";

export type StudentGroupFields = {
  section?: string | null;
  house?: string | null;
  department?: string | null;
  program?: string | null;
  strand?: string | null;
};

// Each student column may only reference a group of the matching category.
const FIELD_CATEGORY = {
  section: "SECTION",
  house: "HOUSE",
  department: "DEPARTMENT",
  program: "PROGRAM",
  strand: "STRAND",
} as const;

export type GroupResolution =
  | { ok: true; slugToId: Map<string, string> }
  | { ok: false; error: string };

/**
 * Every stored slug is lowercase - the seed derives them with `slugify` and the
 * create-group schema lowercases - so a CSV that spells a section "BSIT-3A"
 * refers to exactly the same group as `bsit-3a`. Matching case-sensitively
 * would reject a whole roster over capitalisation, and the error ("Unknown
 * group(s): BSIT-3A") gives an operator no hint that the group they just added
 * *is* the right one. Normalising here can never produce a wrong match, since
 * slugs are unique and already lowercase.
 */
const normalizeSlug = (value: string) => value.trim().toLowerCase();

/**
 * Validates that every group slug referenced by these students exists AND
 * belongs to the category of the column that referenced it, then returns a
 * slug -> id map keyed by the value the caller passed in. Shared by the
 * single-student and bulk-import write paths so both enforce the same
 * integrity rules (a HOUSE slug can't be smuggled into the section column, and
 * unknown slugs are rejected rather than dropped).
 */
export async function validateStudentGroupSlugs(
  students: StudentGroupFields[],
  reader: Pick<Prisma.TransactionClient, "group"> = prisma,
): Promise<GroupResolution> {
  // Keyed by the raw value so callers can keep looking groups up by whatever
  // the form or the CSV actually contained.
  const referenced = new Set<string>();
  for (const s of students) {
    for (const field of Object.keys(
      FIELD_CATEGORY,
    ) as (keyof StudentGroupFields)[]) {
      const slug = s[field];
      if (slug) referenced.add(slug);
    }
  }

  if (referenced.size === 0) return { ok: true, slugToId: new Map() };

  const groups = await reader.group.findMany({
    where: { slug: { in: [...referenced].map(normalizeSlug) } },
    select: { id: true, slug: true, category: true },
  });
  const byNormalizedSlug = new Map(groups.map((g) => [g.slug, g]));

  const groupFor = (raw: string) => byNormalizedSlug.get(normalizeSlug(raw));

  const unknown = [...referenced].filter((slug) => !groupFor(slug));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Unknown group(s): ${unknown.join(", ")}. Fix and retry.`,
    };
  }

  const mismatches = new Set<string>();
  for (const s of students) {
    for (const [field, expected] of Object.entries(FIELD_CATEGORY)) {
      const slug = s[field as keyof StudentGroupFields];
      if (!slug) continue;
      const group = groupFor(slug)!;
      if (group.category !== expected) {
        mismatches.add(
          `"${slug}" is a ${group.category.toLowerCase()}, not a ${expected.toLowerCase()} (column "${field}")`,
        );
      }
    }
  }
  if (mismatches.size > 0) {
    return {
      ok: false,
      error: `Group category mismatch: ${[...mismatches].join("; ")}.`,
    };
  }

  const slugToId = new Map(
    [...referenced].map((raw) => [raw, groupFor(raw)!.id] as const),
  );
  return { ok: true, slugToId };
}
