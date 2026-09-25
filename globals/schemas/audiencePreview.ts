import { EventCategory } from "@prisma/client";
import { z } from "zod";

/** Unsaved event scope plus bounded roster controls. No client-supplied Prisma filters. */
export const audiencePreviewSchema = z.object({
  category: z.enum(EventCategory),
  includedGroups: z.array(z.string().min(1)).max(100).transform((ids) => [...new Set(ids)].sort()),
  eventId: z.string().min(1).optional(),
  search: z.string().trim().max(100).default(""),
  page: z.number().int().min(1).max(10000).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
  includeRoster: z.boolean().default(false),
});

export type AudiencePreviewInput = z.infer<typeof audiencePreviewSchema>;
