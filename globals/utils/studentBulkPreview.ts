import { contentVersion, projectStudentContent } from "./studentContentVersion";
import { studentSchema } from "../schemas/studentSchema";
import type { BulkAction } from "../schemas/studentBulk";
import type { BulkBlockedReasonCode, BulkPreviewRow } from "../types/studentBulk";

export type PreviewStudentInput = {
  id: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  schoolLevel: string;
  yearLevel: string;
  createdAt: Date;
  updatedAt: Date;
  groups: Array<{ id: string; slug: string; name: string; category: string }>;
};

export type PreviewTargetInput = {
  id: string;
  slug: string;
  name: string;
  category: string;
};

const CATEGORY_FIELD: Record<BulkAction, { category: string; field: string }> = {
  SET_SECTION: { category: "SECTION", field: "section" },
  SET_HOUSE: { category: "HOUSE", field: "house" },
};

const FORM_FIELDS = ["section", "house", "department", "program", "strand"] as const;

function slugsForCategory(
  groups: PreviewStudentInput["groups"],
  category: string,
): Array<{ slug: string; name: string; id: string }> {
  return groups
    .filter((g) => g.category === category)
    .map((g) => ({ slug: g.slug, name: g.name, id: g.id }));
}

function singleSlug(groups: PreviewStudentInput["groups"], category: string): string {
  const matches = slugsForCategory(groups, category);
  if (matches.length === 0) return "";
  return matches[0].slug;
}

/**
 * Build preview rows for an explicit ordered ID list. Pure: no DB access, so
 * category-preservation and validation rules are covered by unit tests.
 */
export function buildBulkPreviewRows(input: {
  orderedIds: string[];
  studentsById: Map<string, PreviewStudentInput>;
  target: PreviewTargetInput;
  action: BulkAction;
}): {
  rows: BulkPreviewRow[];
  contentVersions: Record<string, string>;
  beforeLabels: Array<{ id: string; slug: string | null; name: string | null }>;
  counts: { changed: number; unchanged: number; blocked: number };
} {
  const { orderedIds, studentsById, target, action } = input;
  const { category } = CATEGORY_FIELD[action];
  const rows: BulkPreviewRow[] = [];
  const contentVersions: Record<string, string> = {};
  const beforeLabels: Array<{ id: string; slug: string | null; name: string | null }> = [];
  let changed = 0;
  let unchanged = 0;
  let blocked = 0;

  for (const id of orderedIds) {
    const student = studentsById.get(id);
    if (!student) {
      blocked += 1;
      rows.push({
        id,
        firstName: "",
        lastName: "",
        middleName: null,
        before: { slug: null, name: null },
        after: { slug: target.slug, name: target.name },
        status: "BLOCKED",
        reason: "Student no longer exists. Remove from selection.",
        reasonCode: "STUDENT_NOT_FOUND",
      });
      continue;
    }

    const projection = projectStudentContent({
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      middleName: student.middleName,
      schoolLevel: student.schoolLevel,
      yearLevel: student.yearLevel,
      createdAt: student.createdAt,
      updatedAt: student.updatedAt,
      groups: student.groups.map((g) => ({
        id: g.id,
        slug: g.slug,
        category: g.category as never,
      })),
    });
    contentVersions[student.id] = contentVersion(projection);

    const inTargetCategory = slugsForCategory(student.groups, category);
    const before = inTargetCategory[0] ?? null;
    beforeLabels.push({
      id: student.id,
      slug: before?.slug ?? null,
      name: before?.name ?? null,
    });

    const fail = (reason: string, reasonCode: BulkBlockedReasonCode): BulkPreviewRow => {
      blocked += 1;
      return {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        middleName: student.middleName,
        before: { slug: before?.slug ?? null, name: before?.name ?? null },
        after: { slug: target.slug, name: target.name },
        status: "BLOCKED",
        reason,
        reasonCode,
      };
    };

    if (inTargetCategory.length > 1) {
      rows.push(
        fail(
          `Has two ${category.toLowerCase()} assignments. Resolve individually.`,
          "MULTIPLE_MEMBERSHIPS",
        ),
      );
      continue;
    }

    const ambiguous = FORM_FIELDS.some((field) => {
      const cat = field.toUpperCase();
      if (cat === category) return false;
      return slugsForCategory(student.groups, cat).length > 1;
    });
    if (ambiguous) {
      rows.push(
        fail(
          "Has multiple assignments in another category. Resolve individually.",
          "AMBIGUOUS_CATEGORY",
        ),
      );
      continue;
    }

    if (before?.id === target.id || before?.slug === target.slug) {
      unchanged += 1;
      rows.push({
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        middleName: student.middleName,
        before: { slug: before.slug, name: before.name },
        after: { slug: target.slug, name: target.name },
        status: "UNCHANGED",
        reason: null,
        reasonCode: null,
      });
      continue;
    }

    const candidate = {
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      middleName: student.middleName ?? "",
      schoolLevel: student.schoolLevel,
      yearLevel: student.yearLevel,
      section: category === "SECTION" ? target.slug : singleSlug(student.groups, "SECTION"),
      house: category === "HOUSE" ? target.slug : singleSlug(student.groups, "HOUSE"),
      department: singleSlug(student.groups, "DEPARTMENT"),
      program: singleSlug(student.groups, "PROGRAM"),
      strand: singleSlug(student.groups, "STRAND"),
    };
    const parsed = studentSchema.safeParse(candidate);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const path = String(first?.path?.[0] ?? "");
      const missingGroup =
        ["section", "house", "department", "program", "strand"].includes(path) &&
        /required/i.test(first?.message ?? "");
      rows.push(
        fail(
          missingGroup
            ? `Missing required ${path} after this change. Resolve individually.`
            : `Result would be invalid: ${first?.message ?? "check fields"}. Resolve individually.`,
          missingGroup ? "MISSING_REQUIRED_GROUP" : "INVALID_CANDIDATE",
        ),
      );
      continue;
    }

    changed += 1;
    rows.push({
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      middleName: student.middleName,
      before: { slug: before?.slug ?? null, name: before?.name ?? null },
      after: { slug: target.slug, name: target.name },
      status: "CHANGE",
      reason: null,
      reasonCode: null,
    });
  }

  return { rows, contentVersions, beforeLabels, counts: { changed, unchanged, blocked } };
}
