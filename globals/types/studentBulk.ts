import type { BulkAction } from "../schemas/studentBulk";

export type BulkPreviewRowStatus = "CHANGE" | "UNCHANGED" | "BLOCKED";

export type BulkBlockedReasonCode =
  | "STUDENT_NOT_FOUND"
  | "MULTIPLE_MEMBERSHIPS"
  | "AMBIGUOUS_CATEGORY"
  | "INVALID_CANDIDATE"
  | "MISSING_REQUIRED_GROUP";

export type BulkPreviewRow = {
  id: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  before: { slug: string | null; name: string | null };
  after: { slug: string; name: string };
  status: BulkPreviewRowStatus;
  reason: string | null;
  reasonCode: BulkBlockedReasonCode | null;
};

export type BulkPreviewTarget = {
  id: string;
  slug: string;
  name: string;
  category: "SECTION" | "HOUSE";
};

export type BulkPreviewResponse = {
  selectionCount: number;
  changedCount: number;
  unchangedCount: number;
  blockedCount: number;
  action: BulkAction;
  target: BulkPreviewTarget;
  rows: BulkPreviewRow[];
  preparedAt: string;
  expiresAt: string;
  /** Present only when every row is valid and at least one change exists. */
  previewToken: string | null;
};

export type BulkCommitResponse = {
  changedIds: string[];
  unchangedIds: string[];
  committedAt: string;
  target: BulkPreviewTarget;
};

export type BulkRowIssue = {
  id: string;
  reason: string;
  reasonCode: BulkBlockedReasonCode | "STALE" | "TARGET_CHANGED" | string;
};

export type BulkExportRow = {
  studentId: string;
  lastName: string;
  firstName: string;
  middleName: string;
  schoolLevel: string;
  yearLevel: string;
  sectionSlugs: string[];
  houseSlugs: string[];
  departmentSlugs: string[];
  programSlugs: string[];
  strandSlugs: string[];
  preparedAtUtc: string;
};

export type BulkExportResponse = {
  preparedAt: string;
  selectionCount: number;
  schemaVersion: 1;
  rows: BulkExportRow[];
  missingIds?: string[];
};

/** Fixed CSV header order for the selected-student extract. */
export const BULK_EXPORT_HEADERS = [
  "Student ID",
  "Last name",
  "First name",
  "Middle name",
  "School level",
  "Year / Grade",
  "Section slugs",
  "House slugs",
  "Department slugs",
  "Program slugs",
  "Strand slugs",
  "Prepared at (UTC)",
] as const;
