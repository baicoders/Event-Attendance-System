import { z } from "zod";

// Accept stable internal QR payloads, legacy IDs, or external USN/LRN lookup codes.
export const studentIdSchema = z.string().trim().min(1, "Student code is required").max(128, "Student code is too long").refine(value => (value.length === 11 || /^\d{12}$/.test(value) || /^c[a-z0-9]{24}$/.test(value)) && !/[\u0000-\u001f\u007f]/.test(value), "Invalid student code");
