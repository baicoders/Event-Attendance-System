import { SchoolLevel, YearLevel } from "@prisma/client";
import { z } from "zod";
import { studentIdSchema } from "./studentId";

export const studentSchema = z
  .object({
    // Step 1
    id: studentIdSchema,
    firstName: z
      .string()
      .trim()
      .min(1, "First name is required")
      .max(100, "First name is too long"),
    lastName: z
      .string()
      .trim()
      .min(1, "Last name is required")
      .max(100, "Last name is too long"),
    middleName: z
      .string()
      .trim()
      .max(100, "Middle name is too long")
      .optional()
      .or(z.literal("")),

    // Step 2 & 3
    schoolLevel: z.enum(SchoolLevel),
    section: z.string().min(1, "Section is required"),
    house: z.string().min(1, "House is required"),

    // Conditional fields
    yearLevel: z.enum(YearLevel),
    department: z.string().optional(),
    program: z.string().optional(),
    strand: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const hasDepartment = Boolean(data.department && data.department.trim());
    const hasStrand = Boolean(data.strand && data.strand.trim());
    const hasCollegeProgram = Boolean(data.program && data.program.trim());

    switch (data.schoolLevel) {
      case "COLLEGE":
        if (!hasCollegeProgram) {
          ctx.addIssue({
            code: "custom",
            message: "College program is required for college students.",
            path: ["program"],
          });
        }

        if (!hasDepartment) {
          ctx.addIssue({
            code: "custom",
            message: "Department is required for college students.",
            path: ["department"],
          });
        }

        if (hasStrand) {
          ctx.addIssue({
            code: "custom",
            message: "College students should not have an SHS strand.",
            path: ["strand"],
          });
        }

        if (
          data.yearLevel !== YearLevel.YEAR_1 &&
          data.yearLevel !== YearLevel.YEAR_2 &&
          data.yearLevel !== YearLevel.YEAR_3 &&
          data.yearLevel !== YearLevel.YEAR_4
        ) {
          ctx.addIssue({
            code: "custom",
            message: "College students must be from 1st to 4th year.",
            path: ["yearLevel"],
          });
        }
        break;
      case "SHS":
        if (!hasStrand) {
          ctx.addIssue({
            code: "custom",
            message: "SHS strand is required for Senior High School students.",
            path: ["strand"],
          });
        }

        if (hasDepartment) {
          ctx.addIssue({
            code: "custom",
            message: "SHS students should not have a department.",
            path: ["department"],
          });
        }

        if (hasCollegeProgram) {
          ctx.addIssue({
            code: "custom",
            message: "SHS students should not have a college program.",
            path: ["program"],
          });
        }

        if (
          data.yearLevel !== YearLevel.GRADE_11 &&
          data.yearLevel !== YearLevel.GRADE_12
        ) {
          ctx.addIssue({
            code: "custom",
            message: "SHS students must be Grade 11 or Grade 12.",
            path: ["yearLevel"],
          });
        }
        break;

      default:
        break;
    }
  });

export type StudentFormValues = z.infer<typeof studentSchema>;
