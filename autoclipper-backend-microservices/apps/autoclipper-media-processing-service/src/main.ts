import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { loadMediaConfig } from '@autoclipper/configuration';
import { configureHttp, ApplicationLogger, logger } from '@autoclipper/observability';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const config = loadMediaConfig();
  let app: INestApplication | undefined;
  try {
    app = await NestFactory.create(AppModule, { logger: new ApplicationLogger(), bodyParser: false });
    configureHttp(app, config, 'media-processing-service');
    await app.listen(config.PORT, config.HOST);
  } catch (error) { await app?.close(); throw error; }
}
bootstrap().catch(() => { logger.error({ code: 'MEDIA_STARTUP_FAILED' }); process.exitCode = 1; });
