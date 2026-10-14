import {
  createHash,
  randomBytes,
  createHmac,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";

export function seal(value: string, key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
export function unseal(value: string, key: string) {
  const encrypted = Buffer.from(value, "base64");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    encrypted.subarray(0, 12),
  );
  cipher.setAuthTag(encrypted.subarray(12, 28));
  return Buffer.concat([
    cipher.update(encrypted.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { loadGatewayConfig } from "@autoclipper/configuration";

const configSchema = z.object({
  DATABASE_URL: z.url(),
  INTERNAL_TOKEN: z.string().min(32),
  IDENTITY_URL: z.url().default("http://127.0.0.1:3002"),
  WORKSPACE_URL: z.url().default("http://127.0.0.1:3003"),
  CSRF_SIGNING_KEY: z.string().min(32),
});
export function loadServiceConfig() {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      `Invalid configuration: ${parsed.error.issues.map((i) => i.path.join(".")).join(",")}`,
    );
  return { ...loadGatewayConfig(), ...parsed.data };
}
export type ServiceConfig = ReturnType<typeof loadServiceConfig>;
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const opaqueToken = () => randomBytes(32).toString("base64url");
export function same(left: string, right: string) {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function cookieName(name: string) {
  return `${process.env["NODE_ENV"] === "production" ? "__Host-" : ""}autoclipper_${name}`;
}
export function cookie(req: Request, name: string): string {
  const raw = req.headers.cookie ?? "";
  if (raw.length > 8192) throw new BadRequestException();
  const found = raw
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith(cookieName(name) + "="));
  if (found.length > 1) throw new BadRequestException();
  return found[0]?.slice(cookieName(name).length + 1) ?? "";
}
export function setCookie(
  res: Response,
  name: string,
  value: string,
  maxAge: number,
  httpOnly = true,
) {
  res.cookie(cookieName(name), value, {
    httpOnly,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}
export function clearCookies(res: Response) {
  for (const n of ["access", "refresh"]) setCookie(res, n, "", 0);
}
export function issueCsrf(req: Request, res: Response, config: ServiceConfig) {
  void req;
  const payload = `${Date.now()}.${opaqueToken()}`;
  const token = `${payload}.${createHmac("sha256", config.CSRF_SIGNING_KEY).update(payload).digest("base64url")}`;
  setCookie(res, "csrf", token, 1800000, false);
  return { csrfToken: token };
}
export function requireCsrf(req: Request, config: ServiceConfig) {
  if (req.headers.origin !== config.CORS_ORIGIN) throw new ForbiddenException();
  const supplied = req.headers["x-csrf-token"];
  const value = cookie(req, "csrf");
  if (typeof supplied !== "string" || !same(value, supplied))
    throw new ForbiddenException();
  const pieces = value.split(".");
  if (pieces.length !== 3) throw new ForbiddenException();
  const timestamp = Number(pieces[0]);
  const payload = pieces.slice(0, 2).join(".");
  if (
    !Number.isFinite(timestamp) ||
    Date.now() - timestamp > 1800000 ||
    timestamp > Date.now() + 1000 ||
    !same(
      pieces[2] ?? "",
      createHmac("sha256", config.CSRF_SIGNING_KEY)
        .update(payload)
        .digest("base64url"),
    )
  )
    throw new ForbiddenException();
}
export function requireInternal(
  req: Request,
  config: Pick<ServiceConfig, "INTERNAL_TOKEN">,
) {
  const token = req.headers["x-service-token"];
  if (typeof token !== "string" || !same(token, config.INTERNAL_TOKEN))
    throw new UnauthorizedException();
}
export function body<T>(schema: z.ZodType<T>, input: unknown): T {
  const p = schema.safeParse(input);
  if (!p.success) throw new BadRequestException();
  return p.data;
}
export const uuid = (value: string) => body(z.uuid(), value);
export async function internalJson<T>(
  base: string,
  path: string,
  config: Pick<ServiceConfig, "INTERNAL_TOKEN">,
  data: unknown,
): Promise<T> {
  let response: globalThis.Response;
  try {
    response = await fetch(new URL(path, base), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-service-token": config.INTERNAL_TOKEN,
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new ServiceUnavailableException();
  }
  if (response.status === 401) throw new UnauthorizedException();
  if (response.status === 403 || response.status === 404)
    throw new ForbiddenException();
  if (!response.ok) throw new ServiceUnavailableException();
  return (await response.json()) as T;
}
export async function authenticatedUser(
  req: Request,
  config: ServiceConfig,
): Promise<{ id: string; email: string }> {
  const token = cookie(req, "access");
  if (!token) throw new UnauthorizedException();
  return internalJson(
    config.IDENTITY_URL,
    "/v1/internal/authenticate",
    config,
    { token },
  );
}
export async function workspaceAccess(
  config: ServiceConfig,
  userId: string,
  workspaceId: string,
  minimum: "reader" | "editor" | "admin" | "owner" = "reader",
) {
  return internalJson<{ role: string }>(
    config.WORKSPACE_URL,
    "/v1/internal/authorize",
    config,
    { userId, workspaceId, minimum },
  );
}
