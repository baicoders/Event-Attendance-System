/**
 * Seed data and tile presentation for the school's group vocabulary.
 *
 * **The `Group` table is the source of truth, not this file.** Every write path
 * and every picker reads the database: `validateStudentGroupSlugs` resolves
 * student slugs against it, `validateEventGroupIds` resolves event group ids,
 * and the student form, event drawer, and students selection boards all
 * render options fetched from `/api/groups`. Groups are created and deleted by
 * admins in Settings, so a group can perfectly well exist without appearing
 * here.
 *
 * What this file is still for:
 * - the vocabulary `prisma/seed.ts` inserts into a fresh database, and
 * - the per-slug artwork and grouping the `Group` table has no column for
 *   (department logos and abbreviations, house logos, a strand's track),
 *   consumed through `features/students/constants/categories.ts`.
 *
 * Adding an entry here does **not** create a group. It only gives an existing
 * group nicer presentation the next time the boards render it.
 */

export type DepartmentInfo = {
  /** Full name, stored on Student.department */
  name: string;
  /** Stored on Student.departmentSlug and used as event group value */
  slug: string;
  abbreviation: string;
  logo: string;
};

export const DEPARTMENTS: DepartmentInfo[] = [
  {
    name: "Computer Studies",
    slug: "computer-studies",
    abbreviation: "CS Dept.",
    logo: "/logos/department/CS.png",
  },
  {
    name: "Hotel Management",
    slug: "hotel-management",
    abbreviation: "HM Dept.",
    logo: "/logos/department/HM.png",
  },
  {
    name: "Business Administration",
    slug: "business-administration",
    abbreviation: "BA Dept.",
    logo: "/logos/department/AJBE.png",
  },
];

export type ProgramInfo = {
  /** Stored on Student.collegeProgram and used as event group value */
  code: string;
  name: string;
  kind: "DEGREE" | "SHORT";
  /**
   * Department the program belongs to (null = no department assigned yet;
   * new programs start without one until the school assigns it).
   */
  departmentSlug: string | null;
};

export const COLLEGE_PROGRAMS: ProgramInfo[] = [
  // Degree courses
  { code: "BSIT", name: "Bachelor of Science in Information Technology", kind: "DEGREE", departmentSlug: "computer-studies" },
  { code: "BSCS", name: "Bachelor of Science in Computer Science", kind: "DEGREE", departmentSlug: "computer-studies" },
  { code: "BSCRIM", name: "Bachelor of Science in Criminology", kind: "DEGREE", departmentSlug: null },
  { code: "BSISM", name: "Bachelor of Science in Industrial Security Management", kind: "DEGREE", departmentSlug: null },
  { code: "BSHM", name: "Bachelor of Science in Hospitality Management", kind: "DEGREE", departmentSlug: "hotel-management" },
  { code: "BSTM", name: "Bachelor of Science in Tourism Management", kind: "DEGREE", departmentSlug: null },
  { code: "BSENT", name: "Bachelor of Science in Entrepreneurship", kind: "DEGREE", departmentSlug: null },
  { code: "BSBA", name: "Bachelor of Science in Business Administration", kind: "DEGREE", departmentSlug: "business-administration" },
  // Short courses
  { code: "ACT", name: "Associate in Computer Technology", kind: "SHORT", departmentSlug: "computer-studies" },
  { code: "HRT", name: "Diploma in Hotel Restaurant and Technology", kind: "SHORT", departmentSlug: "hotel-management" },
  { code: "OAT", name: "Diploma in Office Administration and Technology", kind: "SHORT", departmentSlug: "business-administration" },
  { code: "OMT", name: "Diploma in Office Management and Technology", kind: "SHORT", departmentSlug: "business-administration" },
  { code: "WAD", name: "Diploma in Web Application and Development", kind: "SHORT", departmentSlug: "computer-studies" },
];

export type StrandInfo = {
  /** Stored on Student.shsStrand and used as event group value */
  code: string;
  name: string;
  track: "ACADEMIC" | "TECHVOC";
};

export const SHS_STRANDS: StrandInfo[] = [
  // Academic track
  { code: "STEM", name: "STEM", track: "ACADEMIC" },
  { code: "ABM", name: "ABM", track: "ACADEMIC" },
  { code: "ASSH", name: "ASSH", track: "ACADEMIC" },
  // Technical-Vocational track
  { code: "CSS", name: "Computer System Servicing", track: "TECHVOC" },
  { code: "HE", name: "Home Economics", track: "TECHVOC" },
  { code: "PROGRAMMING", name: "Programming", track: "TECHVOC" },
  { code: "ANIMATION", name: "Animation", track: "TECHVOC" },
];

export type HouseInfo = {
  /** Full name, stored on Student.house */
  name: string;
  /** Stored on Student.houseSlug and used as event group value */
  slug: string;
  logo: string;
};

export const HOUSES: HouseInfo[] = [
  { name: "Giallio", slug: "giallio", logo: "/logos/house/GIALLIO.png" },
  { name: "Roxxo", slug: "roxxo", logo: "/logos/house/ROXXO.png" },
  { name: "Azul", slug: "azul", logo: "/logos/house/AZUL.png" },
  { name: "Cahel", slug: "cahel", logo: "/logos/house/CAHEL.png" },
  { name: "Vierrdy", slug: "vierrdy", logo: "/logos/house/VIERRDY.png" },
];

export const departmentBySlug = (slug: string | null | undefined) =>
  DEPARTMENTS.find((d) => d.slug === slug);

export const programByCode = (code: string | null | undefined) =>
  COLLEGE_PROGRAMS.find((p) => p.code === code);

/**
 * Section naming convention:
 * College - `<PROGRAM CODE>-<year><letter>`  e.g. BSIT-2A
 * SHS     - `<STRAND CODE>-<grade><letter>`  e.g. STEM-11A, CSS-12B
 */
export const buildSectionName = (
  groupCode: string,
  yearOrGrade: number,
  letter: string
) => `${groupCode}-${yearOrGrade}${letter}`;

const YEAR_LABELS: Record<string, string> = {
  YEAR_1: "1st Year",
  YEAR_2: "2nd Year",
  YEAR_3: "3rd Year",
  YEAR_4: "4th Year",
  GRADE_11: "Grade 11",
  GRADE_12: "Grade 12",
};

/**
 * Human-readable label for a stored group value, given the group type.
 * Falls back to the raw value for anything unmapped (e.g. section names).
 */
export const labelForGroup = (
  type: string,
  value: string | null
): string => {
  if (!value) return "Not provided";
  switch (type) {
    case "DEPARTMENT":
      return DEPARTMENTS.find((d) => d.slug === value)?.name ?? value;
    case "HOUSE":
      return HOUSES.find((h) => h.slug === value)?.name ?? value;
    case "PROGRAM":
      return COLLEGE_PROGRAMS.find((p) => p.code === value)?.code ?? value;
    case "STRAND":
      return SHS_STRANDS.find((s) => s.code === value)?.code ?? value;
    case "YEAR":
      return YEAR_LABELS[value] ?? value;
    default:
      return value;
  }
};
