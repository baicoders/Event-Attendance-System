const editableCategories = new Set(["SECTION", "HOUSE", "DEPARTMENT", "PROGRAM", "STRAND"]);

export function hasAmbiguousStudentGroups(groups: { category: string }[]): boolean {
  const seen = new Set<string>();
  for (const group of groups) {
    if (!editableCategories.has(group.category) || seen.has(group.category)) return true;
    seen.add(group.category);
  }
  return false;
}
