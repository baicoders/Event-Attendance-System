const editableCategories = new Set(["SECTION", "HOUSE", "DEPARTMENT", "PROGRAM", "STRAND"]);

export function hasAmbiguousStudentGroups(groups: { category: string; slug?: string }[]): boolean {
  const seen = new Set<string>();
  for (const group of groups) {
    // Reserved employee identities must not lose their marker through academic edits/imports.
    if (group.slug === "employees") return true;
    if (!editableCategories.has(group.category) || seen.has(group.category)) return true;
    seen.add(group.category);
  }
  return false;
}
