const allowedPaths = new Set(["/students", "/students/student-list", "/students/select-category", "/students/issues"]);
const allowedParams = ["category", "department", "program", "strand", "house", "q", "schoolLevel", "yearLevel", "section", "issue", "missingIdentifier", "recordStatus"];

/** Next's page params retain escapes for encoded path separators. */
export function decodeStudentPageId(value: string): string {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

export function safeStudentReturnHref(candidate: string | null | undefined): string {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return "/students";
  try {
    const url = new URL(candidate, "https://roster.local");
    if (url.origin !== "https://roster.local" || !allowedPaths.has(url.pathname) || /%(?:2e|2f|5c)/i.test(url.pathname)) return "/students";
    if (url.pathname === "/students") return "/students";
    const result = new URLSearchParams();
    for (const key of allowedParams) {
      const value = url.searchParams.get(key);
      if (!value || value.length > 100 || (key !== "q" && !/^[\w-]+$/.test(value))) continue;
      if (key === "category" && !["ALL", "COLLEGE", "SHS", "HOUSE"].includes(value)) continue;
      result.set(key, value);
    }
    return url.pathname + (result.size ? `?${result}` : "");
  } catch {
    return "/students";
  }
}
