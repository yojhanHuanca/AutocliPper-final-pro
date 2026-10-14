import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { loadGatewayConfig } from '@autoclipper/configuration';
import { configureHttp } from '@autoclipper/observability';
import { AppModule } from '../apps/autoclipper-api-gateway/dist/app.module.js';

test('gateway contract, CORS, correlation and safe errors', async () => {
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  const document = configureHttp(app, loadGatewayConfig({ ENABLE_DOCS: 'true' }), 'api-gateway');
  await app.listen(0, '127.0.0.1');
  try {
    const base = await app.getUrl();
    const live = await fetch(`${base}/v1/health/live`, { headers: { origin: 'http://localhost:4200', 'x-correlation-id': 'untrusted-value' } });
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: 'ok' });
    assert.equal(live.headers.get('access-control-allow-origin'), 'http://localhost:4200');
    assert.notEqual(live.headers.get('x-correlation-id'), 'untrusted-value');
    const missing = await fetch(`${base}/v1/secrets?password=do-not-log`);
    const error = await missing.json();
    assert.equal(missing.status, 404);
    assert.equal(error.code, 'RESOURCE_NOT_FOUND');
    assert.equal(error.correlationId, missing.headers.get('x-correlation-id'));
    assert.equal(JSON.stringify(error).includes('do-not-log'), false);
    assert.ok(document.paths['/v1/health/live']);
    assert.equal((await fetch(`${base}/openapi.json`)).status, 200);
  } finally { await app.close(); }
});
