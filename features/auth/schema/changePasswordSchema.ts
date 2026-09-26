import { z } from "zod";

/** Matches the signup rule so a chosen password is never weaker than at signup. */
const newPassword = z
  .string()
  .min(8, "Password must be at least 8 characters");

const baseFields = {
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword,
};

function rejectEqualPasswords(
  data: { currentPassword: string; newPassword: string },
  ctx: z.RefinementCtx,
) {
  // Server-side mirror of the form's equality rule: a direct request must
  // not reuse the temporary password and clear the forced-change flag.
  if (data.newPassword === data.currentPassword) {
    ctx.addIssue({
      code: "custom",
      message: "New password must differ from the current one",
      path: ["newPassword"],
    });
  }
}

/** What `POST /api/auth/change-password` accepts. */
export const changePasswordSchema = z
  .object(baseFields)
  .superRefine(rejectEqualPasswords);

/**
 * What the form collects. The confirmation field is client-side only - the API
 * has no use for it. Built from the same fields (not by extending the refined
 * schema) because Zod v4 forbids extending an object with refinements.
 */
export const changePasswordFormSchema = z
  .object({
    ...baseFields,
    confirmPassword: z.string().min(1, "Please confirm the password"),
  })
  .superRefine((data, ctx) => {
    if (data.newPassword !== data.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        message: "Passwords do not match",
        path: ["confirmPassword"],
      });
    }

    rejectEqualPasswords(data, ctx);
  });

export type ChangePasswordFormValues = z.infer<typeof changePasswordFormSchema>;
