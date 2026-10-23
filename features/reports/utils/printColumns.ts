export const PRINT_COLUMNS = [
  { key: "name", label: "Name", width: 26 },
  { key: "identifier", label: "USN/LRN", width: 15 },
  { key: "group", label: "Group", width: 17 },
  { key: "position", label: "Position", width: 14 },
  { key: "status", label: "Attendance Status", width: 13 },
  { key: "timein", label: "Check-in Time", width: 13 },
  { key: "year", label: "Year", width: 10 },
  { key: "timeout", label: "Check-out Time", width: 13 },
  { key: "method", label: "Method", width: 10 },
  { key: "signature", label: "Signature", width: 16 },
] as const;

export type PrintColumnKey = (typeof PRINT_COLUMNS)[number]["key"];
type QueryValue = string | string[] | undefined;

/** Selection never controls order, and a malformed or empty selection keeps Name. */
export function resolvePrintColumns(value?: QueryValue, legacySignature?: QueryValue): PrintColumnKey[] {
  const requested = value === undefined
    ? PRINT_COLUMNS.filter((column) => column.key !== "method" && (column.key !== "signature" || legacySignature !== "0")).map((column) => column.key)
    : (Array.isArray(value) ? value : [value]).flatMap((entry) => entry.split(","));
  const selected = PRINT_COLUMNS.filter((column) => requested.includes(column.key)).map((column) => column.key);
  return selected.length ? selected : ["name"];
}

/** Preserve row filters and summary options when changing a column checkbox. */
export function setPrintColumn(searchParams: URLSearchParams, key: PrintColumnKey, enabled: boolean): URLSearchParams {
  const params = new URLSearchParams(searchParams.toString());
  const selected = new Set(resolvePrintColumns(params.has("columns") ? params.getAll("columns") : undefined, params.get("signature") ?? undefined));
  if (enabled) selected.add(key);
  else selected.delete(key);
  params.set("columns", resolvePrintColumns([...selected].join(",")).join(","));
  params.delete("signature");
  return params;
}
