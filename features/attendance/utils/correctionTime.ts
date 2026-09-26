const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

export function toManilaInput(value: string | null): string {
  return value ? new Date(new Date(value).getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 19) : "";
}

export function resolveEditedInstant(value: string, original: string | null): string | null {
  if (!value) return null;
  if (original && value === toManilaInput(original)) return original;
  const instant = new Date(`${value}+08:00`);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}
