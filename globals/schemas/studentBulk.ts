import { z } from "zod";

export const BULK_MUTATION_LIMIT = 100;
export const BULK_EXPORT_LIMIT = 5000;
/** Mutation/preview JSON guard: 250 KiB before parsing semantics. */
export const BULK_MUTATION_JSON_LIMIT_BYTES = 250 * 1024;
/** Export JSON guard: 1 MiB before parsing semantics. */
export const BULK_EXPORT_JSON_LIMIT_BYTES = 1024 * 1024;

export const BULK_ACTIONS = ["SET_SECTION", "SET_HOUSE"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

const trimmedId = z.string().trim().min(1, "Student ID is required").max(64);

const uniqueIds = (ids: string[], ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size > 0) {
    ctx.addIssue({
      code: "custom",
      message: `Duplicate student ID(s) in request: ${[...duplicates].join(", ")}`,
      path: ["studentIds"],
    });
  }
};

const studentIdArray = (min: number, max: number) =>
  z
    .array(trimmedId)
    .min(min, "Select at least one student")
    .max(max, `Selection is limited to ${max} students`)
    .superRefine((ids, ctx) => {
      for (const id of ids) {
        if (id.length !== 11) {
          ctx.addIssue({
            code: "custom",
            message: "Each student ID must be 11 characters",
            path: ["studentIds"],
          });
          break;
        }
      }
      uniqueIds(ids, ctx);
    });

export const bulkPreviewSchema = z.object({
  studentIds: studentIdArray(1, BULK_MUTATION_LIMIT),
  action: z.enum(BULK_ACTIONS),
  targetGroupId: z.string().trim().min(1, "Target group is required").max(64),
});

export const bulkCommitSchema = z.object({
  previewToken: z.string().min(1, "Preview token is required").max(32768),
  acknowledgeReportImpact: z.literal(true, {
    message: "Report impact must be acknowledged",
  }),
});

export const bulkExportSelectedSchema = z.object({
  studentIds: studentIdArray(1, BULK_EXPORT_LIMIT),
});

export type BulkPreviewInput = z.infer<typeof bulkPreviewSchema>;
export type BulkCommitInput = z.infer<typeof bulkCommitSchema>;
export type BulkExportSelectedInput = z.infer<typeof bulkExportSelectedSchema>;
