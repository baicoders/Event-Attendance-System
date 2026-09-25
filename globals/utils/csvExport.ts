/** Neutralize spreadsheet formulas after all mapping, including hidden leading whitespace. */
export function escapeCsvFormula(value: string): string {
  return /^(?:[\x00-\x20]*[=+\-@]|[\t\r\n])/.test(value) ? `'${value}` : value;
}

export function escapeCsvFormulas<T>(rows: T[]): T[] {
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" ? escapeCsvFormula(value) : value])) as T;
  });
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function serializeCsv(columns: readonly string[], rows: readonly Record<string, string | number | boolean | null>[]): string {
  const lines = [columns.map(quote).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => {
      const value = row[column];
      if (value === undefined || typeof value === "object" && value !== null) throw new Error(`Invalid CSV cell: ${column}`);
      return quote(typeof value === "string" ? escapeCsvFormula(value) : value === null ? "" : String(value));
    }).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
