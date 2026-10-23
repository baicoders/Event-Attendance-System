import { ComboBoxValue } from "@/globals/components/shared/ComboBox";
import { EventCategory, YearLevel } from "@prisma/client";
import { capitalizeLabel } from "@/globals/utils/text";
import {
  COLLEGE_PROGRAMS,
  DEPARTMENTS,
  HOUSES,
  SHS_STRANDS,
} from "@/globals/constants/groups";

export const EVENT_CHOICES: ComboBoxValue[] = Object.values(EventCategory).map((l) => ({
  value: l,
  label: l === "CUSTOM" ? "Custom Groups" : `${capitalizeLabel(l)} Event`,
}));

// Empty arrays means that the category itself is the group
// Ex: ALL => Everyone, COLLEGE => All College Students
// SECTION is also empty here: sections are derived from the actual students
// in the database (see EventDrawer), never hardcoded.
//
// Every value here matches what is stored on the Student row (see
// globals/constants/groups.ts) so event group filters actually match students.
export const CATEGORY_GROUPS: Record<EventCategory, ComboBoxValue[]> = {
  CUSTOM: [],
  ALL: [],
  COLLEGE: [],
  SHS: [],
  DEPARTMENT: DEPARTMENTS.map((d) => ({ value: d.slug, label: d.name })),
  HOUSE: HOUSES.map((h) => ({ value: h.slug, label: h.name })),
  PROGRAM: COLLEGE_PROGRAMS.map((p) => ({
    value: p.code,
    label: `${p.code} — ${p.name}`,
  })),
  YEAR: Object.keys(YearLevel).map((l) => ({
    value: l,
    label: l,
  })),
  SECTION: [],
  STRAND: SHS_STRANDS.map((s) => ({
    value: s.code,
    label: s.code === s.name ? s.code : `${s.code} — ${s.name}`,
  })),
};

/** Group types that can be excluded from an event (cross-level exclusion). */
export const EXCLUDABLE_GROUP_TYPES = [
  "DEPARTMENT",
  "HOUSE",
  "PROGRAM",
  "STRAND",
  "SECTION",
  "YEAR",
] as const;

export type ExcludableGroupType = (typeof EXCLUDABLE_GROUP_TYPES)[number];

export type ExcludedGroup = {
  type: ExcludableGroupType;
  value: string;
};
