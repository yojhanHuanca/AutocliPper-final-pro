import { z } from "zod";
export const email = z
  .email()
  .max(254)
  .transform((value) => value.trim().toLowerCase());
export const password = z.string().min(12).max(128);
export const registration = z
  .object({ email, password, name: z.string().trim().min(1).max(100) })
  .strict();
export const login = z
  .object({ email, password: z.string().max(128) })
  .strict();
export const token = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const resetRequest = z.object({ email }).strict();
export const reset = z.object({ token: token.shape.token, password }).strict();
export type PublicUser = { id: string; email: string; name: string };
