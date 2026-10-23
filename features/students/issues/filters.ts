import { SchoolLevel, YearLevel } from "@prisma/client";
import type { Option } from "@/globals/types/primitives";
import { STUDENT_ISSUE_LABELS } from "./dataIssues";
export type IssueFilters = {
  q: string;
  schoolLevel: string | null;
  issue: string | null;
  house: string | null;
  missingIdentifier: string | null;
  recordStatus: string | null;
  yearLevel: string | null;
  program: string | null;
  section: string | null;
};
export function parseIssueFilters(
  params: Pick<URLSearchParams, "get">,
): IssueFilters {
  const choice = (key: string, values: readonly string[]) => {
    const value = params.get(key) ?? "";
    return values.includes(value) ? value : "";
  };
  const slug = (key: string) => {
    const value = params.get(key) ?? "";
    return /^[\w-]{1,100}$/.test(value) ? value : "";
  };
  return {
    q: (params.get("q") ?? "").trim().slice(0, 100),
    schoolLevel: choice("schoolLevel", [
      ...Object.values(SchoolLevel),
      "missing",
    ]),
    issue: choice("issue", Object.keys(STUDENT_ISSUE_LABELS)),
    house: choice("house", ["missing"]),
    missingIdentifier: choice("missingIdentifier", ["usn", "lrn", "both"]),
    recordStatus: choice("recordStatus", ["complete", "attention"]),
    yearLevel: choice("yearLevel", Object.values(YearLevel)),
    program: slug("program"),
    section: slug("section"),
  };
}
export function optionsWithCurrentSelection(
  options: Option[],
  selected: string | null,
): Option[] {
  if (!selected || options.some((option) => option.value === selected))
    return options;
  return [
    ...options,
    { value: selected, label: `${selected} (no current assignments)` },
  ];
}
