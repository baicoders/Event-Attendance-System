import { z } from "zod";

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  workspace: z.enum(["EVENTS", "CLASS"]).optional(),
  departmentOrDesignation: z.string().trim().max(160).optional(),
  staffReference: z.string().trim().max(100).optional(),
  applicationText: z.string().trim().max(1000).optional(),
  email: z.string().email("Valid email required").max(254),
  password: z.string().min(8, "Password must be at least 8 characters").max(1024),
}).strict().superRefine((value, ctx) => {
  if (value.workspace === "CLASS" && !value.departmentOrDesignation) ctx.addIssue({ code: "custom", path: ["departmentOrDesignation"], message: "Teacher designation is required." });
});

export type SignupFormValues = z.infer<typeof signupSchema>;
