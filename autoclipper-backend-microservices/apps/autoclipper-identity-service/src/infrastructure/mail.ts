import nodemailer from "nodemailer";
export { seal, unseal } from "@autoclipper/http-security";
export function mailTransport() {
  const production = process.env["NODE_ENV"] === "production";
  const host = process.env["SMTP_HOST"];
  if (!host) throw new Error("SMTP_HOST required");
  return nodemailer.createTransport({
    host,
    port: Number(process.env["SMTP_PORT"] ?? 1025),
    secure: false,
    requireTLS: production,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
    ...(process.env["SMTP_USER"]
      ? {
          auth: {
            user: process.env["SMTP_USER"],
            pass: process.env["SMTP_PASSWORD"] ?? "",
          },
        }
      : {}),
  });
}
