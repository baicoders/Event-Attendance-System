export type SheetGrouping = "NONE" | "SECTION" | "CUSTOM";

/** Older print links use grouped=0 to turn section grouping off. */
export function resolveSheetGrouping(value: string | string[] | undefined, legacyGrouped?: string | string[]): SheetGrouping {
  if (value === "NONE" || value === "SECTION" || value === "CUSTOM") return value;
  return legacyGrouped === "0" ? "NONE" : "SECTION";
}
