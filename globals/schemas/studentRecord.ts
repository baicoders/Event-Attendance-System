import { SchoolLevel, YearLevel } from '@prisma/client';
import { z } from 'zod';

// USN retains the existing eleven-character text contract. Do not coerce numbers:
// spreadsheet numeric conversion can permanently lose meaningful leading zeros.
export const usnSchema = z.string().trim().length(11, 'USN must be 11 characters');
export const lrnSchema = z.string().trim().regex(/^\d{12}$/, 'LRN must be exactly 12 digits');
const optionalIdentifier = (schema: z.ZodString) => schema.or(z.literal('')).nullish();
const optionalText = z.string().trim().max(100).nullish();

export const studentRecordSchema = z.object({
  id: z.string().trim().max(128).optional(),
  usn: optionalIdentifier(usnSchema),
  lrn: optionalIdentifier(lrnSchema),
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  middleName: optionalText,
  schoolLevel: z.enum(SchoolLevel).nullish(),
  yearLevel: z.enum(YearLevel).nullish(),
  section: optionalText, house: optionalText, department: optionalText,
  program: optionalText, strand: optionalText,
}).superRefine((data, ctx) => {
  const issue = (field: string, message: string) => ctx.addIssue({code:'custom',path:[field],message});
  if (!data.usn && !data.lrn) issue('usn', 'At least one of USN or LRN is required');
  if (data.schoolLevel === 'SHS') {
    if (data.department) issue('department', 'SHS students should not have a department.');
    if (data.program) issue('program', 'SHS students should not have a college program.');
    if (data.yearLevel && !(['GRADE_11','GRADE_12'] as string[]).includes(data.yearLevel)) issue('yearLevel', 'SHS students must be Grade 11 or Grade 12.');
  }
  if (data.schoolLevel === 'COLLEGE') {
    if (data.strand) issue('strand', 'College students should not have an SHS strand.');
    if (data.yearLevel && !(['YEAR_1','YEAR_2','YEAR_3','YEAR_4'] as string[]).includes(data.yearLevel)) issue('yearLevel', 'College students must be from 1st to 4th year.');
  }
  if (data.strand && (data.department || data.program)) issue('strand', 'SHS strand cannot be combined with college program or department.');
});
export type StudentRecordValues = z.infer<typeof studentRecordSchema>;
