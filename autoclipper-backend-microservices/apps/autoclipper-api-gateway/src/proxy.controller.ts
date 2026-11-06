import {
  All,
  Controller,
  Req,
  Res,
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request, Response } from "express";
@ApiExcludeController()
@Controller()
export class ProxyController {
  @All([
    "admin",
    "admin/*path",
    "auth",
    "auth/*path",
    "workspaces",
    "workspaces/*path",
    "social/*path",
    "projects",
    "projects/*path",
    "uploads/*path",
    "processing/*path",
    "analyses/*path",
    "pipelines/*path",
    "consumption/*path",
    "edits/*path",
    "review-links/*path",
  ])
  async forward(@Req() req: Request, @Res() res: Response) {
    const raw = req.originalUrl.split("?")[0] ?? "";
    const segments = raw.split("/").slice(2);
    if (!segments.length || segments.some((s) => !/^[a-zA-Z0-9_-]+$/.test(s)))
      throw new BadRequestException();
    const root = segments[0];
    const base =
      root === "auth" || root === "admin"
        ? process.env["IDENTITY_URL"]
        : root === "consumption"
          ? process.env["BILLING_URL"]
        : root === "workspaces"
          ? process.env["WORKSPACE_URL"]
          : process.env["PROJECT_URL"];
    if (!base) throw new ServiceUnavailableException();
    const headers: Record<string, string> = {};
    for (const name of [
      "cookie",
      "origin",
      "content-type",
      "x-csrf-token",
      "idempotency-key",
      "if-match",
    ]) {
      const value = req.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    // Never forward an internal credential supplied by a browser.
    const token = process.env["INTERNAL_TOKEN"];
    if (token) headers["x-service-token"] = token;
    headers['x-client-ip']=req.ip??'';
    headers["x-correlation-id"] = String(res.locals["correlationId"]);
    let upstream: globalThis.Response;
    try {
      const timeoutMs = req.method === "POST" && /^\/v1\/projects\/[0-9a-f-]+\/source-links\/import$/u.test(raw) ? 330000 : req.method === "POST" && /^\/v1\/uploads\/[^/]+\/confirm$/u.test(raw) ? 600000 : 20000;
      upstream = await fetch(new URL(req.originalUrl, base), {
        method: req.method,
        headers,
        ...(["GET", "HEAD"].includes(req.method)
          ? {}
          : { body: JSON.stringify(req.body ?? {}) }),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException();
    }
    for (const value of upstream.headers.getSetCookie())
      res.appendHeader("set-cookie", value);
    if(upstream.status>=300&&upstream.status<400) {
      const expected=new URL("/app/settings?provider=twitch&status=linked",process.env["CORS_ORIGIN"]??"http://localhost:4200").toString();
      const socialCallback=/^\/v1\/social\/(youtube|tiktok)\/callback$/u.exec(raw);
      const socialRedirects=socialCallback?["linked","denied"].map(status=>new URL(`/app/settings?social=${socialCallback[1]}&status=${status}`,process.env["CORS_ORIGIN"]??"http://localhost:4200").toString()):[];
      if(req.method!=="GET"||upstream.status!==303||!((raw==="/v1/auth/twitch/callback"&&upstream.headers.get("location")===expected)||socialRedirects.includes(upstream.headers.get("location")??""))) throw new ServiceUnavailableException();
      res.setHeader("location",upstream.headers.get("location")!).status(303).end();
      return;
    }
    if(req.method==="GET"&&/^\/v1\/uploads\/[0-9a-f-]+\/source-playback$/iu.test(raw)){res.setHeader("cache-control","no-store");res.setHeader("referrer-policy","no-referrer");}
    if(/^\/v1\/auth\/privacy-requests(?:\/|$)/iu.test(raw))res.setHeader("cache-control","private, no-store");
    const type = upstream.headers.get("content-type");
    if (type) res.setHeader("content-type", type);
    const etag = upstream.headers.get("etag");
    if (etag) res.setHeader("etag", etag);
    // Bounded JSON APIs only; videos travel directly through signed storage URLs.
    const payload = await upstream.text();
    if (payload.length > 1048576) throw new ServiceUnavailableException();
    if (upstream.status >= 400) {
      try {
        const error = JSON.parse(payload) as {
          code?: string;
          message?: string;
        };
        res.status(upstream.status).json({
          code: error.code ?? "UPSTREAM_ERROR",
          message: "Request could not be completed",
          correlationId: res.locals["correlationId"],
        });
        return;
      } catch {
        throw new ServiceUnavailableException();
      }
    }
    res.status(upstream.status).send(payload);
  }
}
