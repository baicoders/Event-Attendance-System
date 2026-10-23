import { EventCategory, YearLevel } from "@prisma/client";

import {
  COLLEGE_PROGRAMS,
  DEPARTMENTS,
  HOUSES,
  SHS_STRANDS,
} from "@/globals/constants/groups";

const SCOPED_CATEGORIES: EventCategory[] = [
  "CUSTOM",
  "DEPARTMENT",
  "HOUSE",
  "STRAND",
  "PROGRAM",
  "SECTION",
  "YEAR",
];

// SECTION is intentionally absent: section names live on student rows and
// change every school year, so they cannot be validated against constants.
const VALID_GROUP_VALUES: Partial<Record<string, Set<string>>> = {
  DEPARTMENT: new Set(DEPARTMENTS.map((d) => d.slug)),
  HOUSE: new Set(HOUSES.map((h) => h.slug)),
  PROGRAM: new Set(COLLEGE_PROGRAMS.map((p) => p.code)),
  STRAND: new Set(SHS_STRANDS.map((s) => s.code)),
  YEAR: new Set(Object.keys(YearLevel)),
};

const parseJsonArray = (json: string | null | undefined): unknown[] | null => {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Server-side validation of an event's group selections against the real
 * vocabulary. Returns an error message, or null when everything is valid.
 */
export function validateEventGroups(
  category: EventCategory,
  includedGroupsJson: string | null | undefined,
  excludedGroupsJson: string | null | undefined
): string | null {
  const included = parseJsonArray(includedGroupsJson);
  if (included === null) {
    return "includedGroups must be a JSON array.";
  }

  if (SCOPED_CATEGORIES.includes(category)) {
    if (included.length === 0) {
      return "At least one group must be selected for this category.";
    }

    const pool = VALID_GROUP_VALUES[category];
    for (const value of included) {
      if (typeof value !== "string" || value.length === 0) {
        return "Group values must be non-empty strings.";
      }
      if (pool && !pool.has(value)) {
        return `Unknown ${category.toLowerCase()} group: ${value}`;
      }
    }
  }

  const excluded = parseJsonArray(excludedGroupsJson);
  if (excluded === null) {
    return "excludedGroups must be a JSON array.";
  }

  for (const entry of excluded) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as { type?: unknown }).type !== "string" ||
      typeof (entry as { value?: unknown }).value !== "string" ||
      (entry as { value: string }).value.length === 0
    ) {
      return "Each exclusion must be a { type, value } pair.";
    }

    const { type, value } = entry as { type: string; value: string };
    if (type !== "SECTION" && !VALID_GROUP_VALUES[type]) {
      return `Unknown exclusion type: ${type}`;
    }

    const pool = VALID_GROUP_VALUES[type];
    if (pool && !pool.has(value)) {
      return `Unknown ${type.toLowerCase()} exclusion: ${value}`;
    }
  }

  return null;
}
