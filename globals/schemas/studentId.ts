import { z } from "zod";

// The current student form accepts 11-character IDs, including leading zeros.
// Keep scanner validation aligned with that form instead of assuming digits.
export const studentIdSchema = z.string().trim().min(1, "Student ID is required").length(11, "ID must be 11 characters");
