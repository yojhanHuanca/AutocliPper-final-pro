import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { loadGatewayConfig } from '@autoclipper/configuration';
import { configureHttp } from '@autoclipper/observability';
import { AppModule as GatewayModule } from '../apps/autoclipper-api-gateway/dist/app.module.js';
import { InspectionRuntime } from '../apps/autoclipper-media-processing-service/dist/application/inspection-runtime.js';
import { Module } from '@nestjs/common';
import { OperationsController } from '../apps/autoclipper-media-processing-service/dist/interfaces/operations.controller.js';

// Contract generation must not instantiate database/queue clients or start workers.
class MediaContractModule {}
Module({ controllers: [OperationsController], providers: [{ provide: InspectionRuntime, useValue: {} }] })(MediaContractModule);
const directory = new URL('../../autoclipper-project-documentation/contracts/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const [name, module] of [['gateway', GatewayModule], ['media', MediaContractModule]]) {
  const app = await NestFactory.create(module, { logger: false });
  try {
    const document = configureHttp(app, loadGatewayConfig(), name === 'gateway' ? 'api-gateway' : 'media-processing-service');
    await writeFile(new URL(`${name}.openapi.json`, directory), JSON.stringify(document, null, 2) + '\n');
  } finally { await app.close(); }
}
console.log('OpenAPI documents exported. Only implemented operational routes are included.');
