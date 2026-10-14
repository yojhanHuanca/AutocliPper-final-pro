import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadGatewayConfig } from '@autoclipper/configuration';
import { ApplicationLogger, configureHttp, logger } from '@autoclipper/observability';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const config = loadGatewayConfig();
  const app = await NestFactory.create(AppModule, { logger: new ApplicationLogger(), bodyParser: false });
  configureHttp(app, config, 'api-gateway');
  await app.listen(config.PORT, config.HOST);
}
bootstrap().catch(() => { logger.error({ code: 'GATEWAY_STARTUP_FAILED' }); process.exitCode = 1; });
