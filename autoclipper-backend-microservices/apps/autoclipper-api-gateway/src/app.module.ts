import { Controller, Get, Module, Res } from "@nestjs/common";
import type { Response } from "express";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { HealthResponse, ReadinessResponse } from "@autoclipper/api-contracts";
import { ProxyController } from "./proxy.controller.js";

@ApiTags("operations")
@Controller("health")
export class HealthController {
  @Get("live")
  @ApiOkResponse({ type: HealthResponse })
  live(): HealthResponse {
    return { status: "ok" };
  }
  @Get("ready")
  @ApiOkResponse({ type: ReadinessResponse })
  async ready(
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReadinessResponse> {
    const checks: Record<string, "ok" | "unavailable"> = {};
    if (process.env["COOKIE_AUTH"] === "true")
      await Promise.all(
        ["identity", "workspace", "project"].map(async (name) => {
          try {
            const endpoint = process.env[`${name.toUpperCase()}_URL`];
            if (!endpoint) throw new Error("Missing upstream");
            const ready = await fetch(new URL("/v1/health/ready", endpoint), {
              signal: AbortSignal.timeout(3000),
            });
            checks[name] = ready.ok ? "ok" : "unavailable";
          } catch {
            checks[name] = "unavailable";
          }
        }),
      );
    const status = Object.values(checks).every((check) => check === "ok")
      ? "ok"
      : "unavailable";
    if (status !== "ok") response.status(503);
    return { status, checks };
  }
}
@Module({ controllers: [HealthController, ProxyController] })
export class AppModule {}
