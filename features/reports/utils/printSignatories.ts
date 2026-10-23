export const DEFAULT_NOTED_BY = "Office of Student Affairs";
export const NOTED_BY_MAX_LENGTH = 160;

export function resolveNotedBy(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.slice(0, NOTED_BY_MAX_LENGTH).trim() : DEFAULT_NOTED_BY;
}
