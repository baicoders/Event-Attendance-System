import z from "zod";

export const loginSchema = z.object({
  workspace: z.enum(["EVENTS", "CLASS"]).optional(),
	email: z.string().min(1, "Email is required"),
	password: z.string().min(1, "Password is required"),
});

export type LoginFormValues = z.infer<typeof loginSchema>;