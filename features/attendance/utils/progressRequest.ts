import type { ProgressQuery } from "@/globals/utils/attendanceProgressQuery";

export function progressRequestParams(query: ProgressQuery): string {
  const params = new URLSearchParams({ groupBy: query.groupBy });
  if (query.includeRows) {
    params.set("includeRows", "1");
    params.set("bucket", query.bucket);
    params.set("status", query.status);
    if (query.q.trim()) params.set("q", query.q.trim());
    params.set("page", String(query.page));
    params.set("pageSize", String(query.pageSize));
  }
  return params.toString();
}
