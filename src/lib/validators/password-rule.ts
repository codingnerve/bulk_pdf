import { z } from "zod";

/** Isomorphic password policy (used by the server schemas and the browser forms). */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Password must contain a letter and a number");
