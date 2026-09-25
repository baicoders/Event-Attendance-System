import { YearLevel } from "@prisma/client";

export const PROGRESS_DIMENSIONS = ["SECTION", "DEPARTMENT", "PROGRAM", "STRAND", "HOUSE", "YEAR"] as const;
export type ProgressDimension = (typeof PROGRESS_DIMENSIONS)[number];
export const PROGRESS_STATUSES = ["NOT_YET", "CHECKED_IN", "ALL"] as const;
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];
export const PROGRESS_PAGE_SIZES = [10, 25, 50, 100] as const;

export type ProgressQuery = {
  groupBy: ProgressDimension;
  includeRows: boolean;
  bucket: string;
  status: ProgressStatus;
  q: string;
  page: number;
  pageSize: (typeof PROGRESS_PAGE_SIZES)[number];
};

export class ProgressQueryError extends Error {
  constructor(message: string, public code = "INVALID_PROGRESS_QUERY") {
    super(message);
  }
}

export function parseProgressQuery(params: URLSearchParams): ProgressQuery {
  const allowed = new Set(["groupBy", "includeRows", "bucket", "status", "q", "page", "pageSize"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) throw new ProgressQueryError(`Invalid progress parameter: ${key}`);
  }
  const groupBy = params.get("groupBy") ?? "SECTION";
  const status = params.get("status") ?? "NOT_YET";
  const includeRows = params.get("includeRows") ?? "0";
  const bucket = params.get("bucket") ?? "all";
  const q = (params.get("q") ?? "").trim();
  const rawPage = params.get("page") ?? "1";
  const rawPageSize = params.get("pageSize") ?? "50";
  if (!PROGRESS_DIMENSIONS.includes(groupBy as ProgressDimension)) throw new ProgressQueryError("Invalid breakdown dimension.");
  if (!PROGRESS_STATUSES.includes(status as ProgressStatus)) throw new ProgressQueryError("Invalid detail status.");
  if (includeRows !== "0" && includeRows !== "1") throw new ProgressQueryError("Invalid includeRows value.");
  if (!/^\d+$/.test(rawPage) || Number(rawPage) < 1 || !Number.isSafeInteger(Number(rawPage))) throw new ProgressQueryError("Invalid page.");
  const pageSize = Number(rawPageSize);
  if (!PROGRESS_PAGE_SIZES.includes(pageSize as ProgressQuery["pageSize"])) throw new ProgressQueryError("Unsupported page size.");
  if (q.length > 100) throw new ProgressQueryError("Search is too long.");
  const relationBucket = bucket === "all" || bucket === "none" || bucket === "multiple" || /^g:[^:]{1,128}$/.test(bucket);
  const yearBucket = bucket === "all" || (bucket.startsWith("y:") && Object.values(YearLevel).includes(bucket.slice(2) as YearLevel));
  if (groupBy === "YEAR" ? !yearBucket : !relationBucket) {
    throw new ProgressQueryError("Invalid bucket for this dimension.", "INVALID_PROGRESS_BUCKET");
  }
  return {
    groupBy: groupBy as ProgressDimension,
    includeRows: includeRows === "1",
    bucket,
    status: status as ProgressStatus,
    q,
    page: Number(rawPage),
    pageSize: pageSize as ProgressQuery["pageSize"],
  };
}
