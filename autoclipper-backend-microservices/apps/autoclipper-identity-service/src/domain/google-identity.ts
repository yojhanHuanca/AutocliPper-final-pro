import { z } from "zod";

export const googleProof = z.object({
  credential: z.string().min(20).max(12000),
  factor: z.string().regex(/^(\d{6}|[a-f0-9]{24})$/).optional(),
}).strict();

const claims = z.object({
  sub: z.string().min(1).max(255),
  email: z.email().max(254),
  email_verified: z.literal(true),
  name: z.string().trim().min(1).max(100).optional(),
  nonce: z.string(),
  exp: z.number().int(),
  iat: z.number().int(),
  hd: z.string().min(1).optional(),
  azp: z.string().optional(),
});

// Call only after cryptographic verification by Google's SDK. This is not a JWT decoder.
export function verifiedGoogleIdentity(payload: unknown, nonce: string, clientId: string, now = Date.now()) {
  const parsed = claims.safeParse(payload);
  if (!parsed.success) return undefined;
  const value = parsed.data;
  if (value.nonce !== nonce || value.exp <= now / 1000 || value.iat > now / 1000 + 60 || value.iat < now / 1000 - 600 || (value.azp && value.azp !== clientId)) return undefined;
  const email = value.email.toLowerCase();
  return { subject: value.sub, email, name: value.name ?? "Google account", authoritativeEmail: email.endsWith("@gmail.com") || Boolean(value.hd) };
}
