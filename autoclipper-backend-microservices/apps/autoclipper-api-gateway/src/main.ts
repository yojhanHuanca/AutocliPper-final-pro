import "reflect-metadata";
import { readFile } from "node:fs/promises";
import type { OpenAPIObject } from "@nestjs/swagger";
import { NestFactory } from "@nestjs/core";
import { loadGatewayConfig } from "@autoclipper/configuration";
import {
  ApplicationLogger,
  configureHttp,
  logger,
} from "@autoclipper/observability";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const config = loadGatewayConfig();
  const app = await NestFactory.create(AppModule, {
    logger: new ApplicationLogger(),
  });
  if (
    config.COOKIE_AUTH &&
    ["IDENTITY_URL", "WORKSPACE_URL", "PROJECT_URL", "INTERNAL_TOKEN"].some(
      (name) => !process.env[name],
    )
  )
    throw new Error("Gateway upstream configuration required");
  const contract = JSON.parse(
    await readFile(
      new URL("../contracts/public.openapi.json", import.meta.url),
      "utf8",
    ),
  ) as OpenAPIObject;
  configureHttp(app, config, "api-gateway", contract);
  await app.listen(config.PORT, config.HOST);
}
bootstrap().catch(() => {
  logger.error({ code: "GATEWAY_STARTUP_FAILED" });
  process.exitCode = 1;
});
