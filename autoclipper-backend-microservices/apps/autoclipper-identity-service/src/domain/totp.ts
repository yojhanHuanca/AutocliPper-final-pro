import { Secret, TOTP } from "otpauth";
export function newTotp(email: string) {
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: "AutoClipper",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
  return { secret: secret.base32, uri: totp.toString() };
}
export function totpStep(
  secret: string,
  token: string,
  timestamp = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(token)) return null;
  const delta = new TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  }).validate({ token, window: 1, timestamp });
  return delta === null ? null : Math.floor(timestamp / 30000) + delta;
}
