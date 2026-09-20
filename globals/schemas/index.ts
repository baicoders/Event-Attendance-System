import { EventCategory } from "@prisma/client";
import z from "zod";

/**
 * Zod schema for event form validation
 * Validates event properties and ensures business logic constraints
 */
export const eventSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().min(1, "Title is required").max(200, "Title is too long"),
    location: z.string().max(200, "Location is too long").nullable(),
    category: z.enum(EventCategory),
    includedGroups: z.array(z.string()), // group id array
    start: z.date(),
    end: z.date(),
    description: z.string().max(2000, "Description is too long").nullable(),
    allDay: z.boolean(),
    // Set by the client only after the admin confirms the consequence of
    // rescoping an approved event that already has attendance. The server
    // rejects such a change with AUDIENCE_CHANGE_HAS_RECORDS unless this is true.
    acknowledgeAudienceChange: z.boolean().optional(),
  })
  // Validate that end date is after start date
  .refine(
    (data) => {
      if (data.allDay) {
        // For all-day events, compare only the date portion (ignore time)
        const startDay = new Date(
          data.start.getFullYear(),
          data.start.getMonth(),
          data.start.getDate(),
        );
        const endDay = new Date(
          data.end.getFullYear(),
          data.end.getMonth(),
          data.end.getDate(),
        );
        return endDay >= startDay;
      }

      // For timed events, allow same start/end to avoid false blocking on untouched forms.
      return data.end >= data.start;
    },
    {
      message: "End date must be the same or after start date",
      path: ["end"],
    },
  )
  // Validate that includedGroups is provided when needed
  .refine(
    (data) => {
      const globalCategories = ["ALL", "COLLEGE", "SHS"];
      if (globalCategories.includes(data.category)) return true;
      // Enforce at least one group ID is selected for targeted events
      return data.includedGroups.length > 0;
    },
    {
      message: "Please select at least one target group",
      path: ["includedGroups"],
    },
  );
		
