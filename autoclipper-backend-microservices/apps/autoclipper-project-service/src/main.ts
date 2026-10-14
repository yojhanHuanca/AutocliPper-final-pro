import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadServiceConfig } from "@autoclipper/http-security";
import {
  ApplicationLogger,
  configureHttp,
  logger,
} from "@autoclipper/observability";
import { AppModule } from "./app.module.js";
async function start() {
  const config = loadServiceConfig();
  const app = await NestFactory.create(AppModule, {
    logger: new ApplicationLogger(),
  });
  try {
    configureHttp(app, config, "project-service");
    await app.listen(config.PORT, config.HOST);
  } catch (error) {
    await app.close();
    throw error;
  }
}
start().catch(() => {
  logger.error({ code: "PROJECT_STARTUP_FAILED" });
  process.exitCode = 1;
});
