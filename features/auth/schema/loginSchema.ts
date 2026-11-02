import z from "zod";

export const loginSchema = z.object({
  workspace: z.enum(["EVENTS", "CLASS"]).optional(),
	email: z.string().min(1, "Email is required").max(254),
	password: z.string().min(1, "Password is required").max(1024),
});

export type LoginFormValues = z.infer<typeof loginSchema>;