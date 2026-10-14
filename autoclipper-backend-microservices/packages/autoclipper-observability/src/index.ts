import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter, type INestApplication, type LoggerService } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { pino } from 'pino';
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';
import type { GatewayConfig } from '@autoclipper/configuration';

export const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info', redact: {
  paths: ['password', 'token', 'authorization', 'cookie', 'secret', 'req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.secret'], censor: '[REDACTED]'
} });
// Framework messages can embed arbitrary details. Only log the safe message and context.
export class ApplicationLogger implements LoggerService {
  log(message: unknown) { if (typeof message === 'string') logger.info({ message }); }
  error() { logger.error({ code: 'FRAMEWORK_ERROR' }); }
  warn(message: unknown) { if (typeof message === 'string') logger.warn({ message }); }
  debug(message: unknown) { if (typeof message === 'string') logger.debug({ message }); }
  verbose(message: unknown) { if (typeof message === 'string') logger.debug({ message }); }
}

export const registry = new Registry();
collectDefaultMetrics({ register: registry });
const requests = new Histogram({ name: 'autoclipper_http_duration_seconds', help: 'HTTP duration in seconds', labelNames: ['method', 'status'], registers: [registry], buckets: [0.01, 0.1, 0.5, 1, 5] });

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const codes: Record<number, string> = { 400: 'INVALID_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'RESOURCE_NOT_FOUND', 409: 'CONFLICT', 429: 'RATE_LIMITED', 503: 'DEPENDENCY_UNAVAILABLE' };
    if (status >= 500) logger.error({ code: 'REQUEST_FAILED', correlationId: response.locals['correlationId'], status });
    response.status(status).json({ code: codes[status] ?? 'INTERNAL_ERROR', message: 'Request could not be completed', correlationId: response.locals['correlationId'] });
  }
}

export function configureHttp(app: INestApplication, config: GatewayConfig, service: string) {
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  app.use(helmet());
  app.enableCors({ origin: config.CORS_ORIGIN, credentials: false, methods: ['GET', 'HEAD', 'OPTIONS'], allowedHeaders: ['content-type', 'x-correlation-id'], exposedHeaders: ['x-correlation-id'] });
  app.use((_req: Request, res: Response, next: NextFunction) => {
    // Do not trust external trace/correlation identifiers. The boundary generates one.
    const correlationId = randomUUID();
    res.locals['correlationId'] = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('Cache-Control', 'no-store');
    const end = requests.startTimer();
    res.on('finish', () => { end({ method: _req.method, status: String(res.statusCode) }); logger.info({ service, correlationId, method: _req.method, status: res.statusCode }); });
    next();
  });
  app.useGlobalFilters(new SafeExceptionFilter());
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle(`AutoClipper ${service}`).setVersion('0.1.0').addBearerAuth().build());
  if (config.ENABLE_DOCS) SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'openapi.json' });
  return document;
}
