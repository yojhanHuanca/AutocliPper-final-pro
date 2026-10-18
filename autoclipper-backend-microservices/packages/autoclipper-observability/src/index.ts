import 'reflect-metadata';
import { randomUUID,timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter, type INestApplication, type LoggerService } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule,type OpenAPIObject } from '@nestjs/swagger';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { pino } from 'pino';
import { collectDefaultMetrics, Histogram, Counter, Registry } from '@prometheus-io/client';
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
const derivativeDuration = new Histogram({name:'autoclipper_derivative_attempt_seconds',help:'Measured derivative attempt duration, including source verification and upload',labelNames:['operation','status'],registers:[registry],buckets:[0.1,1,5,15,30,60,180,600]});
const derivativeBytes = new Counter({name:'autoclipper_derivative_produced_bytes_total',help:'Bytes in successfully published derivative artifacts',labelNames:['operation'],registers:[registry]});
export function recordDerivativeAttempt(operation:'clip'|'audio',status:'succeeded'|'failed'|'cancelled'|'retry',seconds:number,bytes=0){derivativeDuration.observe({operation,status},seconds);if(bytes>0)derivativeBytes.inc({operation},bytes);}

const analysisDuration=new Histogram({name:'autoclipper_analysis_attempt_seconds',help:'Measured content analysis attempt duration',labelNames:['provider','status'],registers:[registry],buckets:[0.1,1,5,15,30,60,180,300,600]});
const analysisAudioSeconds=new Counter({name:'autoclipper_analysis_source_seconds_total',help:'Source duration of successful analysis jobs; not a billing ledger',labelNames:['provider'],registers:[registry]});
export function recordAnalysisAttempt(provider:'whisper_cpp'|'deepgram',status:'succeeded'|'failed'|'cancelled'|'retry',seconds:number,sourceSeconds=0){analysisDuration.observe({provider,status},seconds);if(sourceSeconds>0)analysisAudioSeconds.inc({provider},sourceSeconds);}

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const codes: Record<number, string> = { 400: 'INVALID_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'RESOURCE_NOT_FOUND', 409: 'CONFLICT', 412: 'VERSION_CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 415:'UNSUPPORTED_MEDIA', 428:'PRECONDITION_REQUIRED', 429: 'RATE_LIMITED', 503: 'DEPENDENCY_UNAVAILABLE' };
    if (status >= 500) logger.error({ code: 'REQUEST_FAILED', correlationId: response.locals['correlationId'], status });
    const detail = exception instanceof HttpException ? exception.getResponse() : undefined;
    const explicit = typeof detail === 'object' && detail !== null && 'code' in detail ? detail.code : undefined;
    const safeCodes: Record<string, number> = { GOOGLE_NOT_CONFIGURED: 503, ACCOUNT_LINK_REQUIRED: 409, TRANSCRIPTION_NOT_CONFIGURED:503, SELECTION_NOT_CONFIGURED:503, AI_BUDGET_NOT_AUTHORIZED:503, LOCAL_TRANSCRIPTION_DURATION_LIMIT:400, INVALID_SELECTION_REQUEST:400, MANUAL_PROCESSING_NOT_ADMITTED:403, PRIVACY_SNAPSHOT_CHANGED:409, PRIVACY_EXPORT_NOT_PENDING:409 };
    const code = typeof explicit === 'string' && safeCodes[explicit] === status ? explicit : codes[status] ?? 'INTERNAL_ERROR';
    response.status(status).json({ code, message: 'Request could not be completed', correlationId: response.locals['correlationId'] });
  }
}

export function configureHttp(app: INestApplication, config: GatewayConfig, service: string,published?:OpenAPIObject) {
  const server = app.getHttpServer() as Server;
  server.headersTimeout = 5000;
  server.requestTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  app.use(helmet());
  app.enableCors({ origin: config.CORS_ORIGIN, credentials: config.COOKIE_AUTH, methods: ['GET','HEAD','POST','PATCH','DELETE','OPTIONS'], allowedHeaders: ['content-type','x-correlation-id','x-csrf-token','idempotency-key','if-match'], exposedHeaders: ['x-correlation-id','etag'] });
  app.use((_req: Request, res: Response, next: NextFunction) => {
    // Do not trust external trace/correlation identifiers. The boundary generates one.
    const supplied=_req.headers['x-correlation-id'];const credential=_req.headers['x-service-token'];const expected=process.env['INTERNAL_TOKEN'];
    const trusted=typeof credential==='string'&&expected&&Buffer.byteLength(credential)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(credential),Buffer.from(expected));
    const correlationId=trusted&&typeof supplied==='string'&&/^[a-f0-9-]{36}$/i.test(supplied)?supplied:randomUUID();
    res.locals['correlationId'] = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('Cache-Control', 'no-store');
    const end = requests.startTimer();
    res.on('finish', () => { end({ method: _req.method, status: String(res.statusCode) }); logger.info({ service, correlationId, method: _req.method, status: res.statusCode }); });
    next();
  });
  app.useGlobalFilters(new SafeExceptionFilter());
  const document = published??SwaggerModule.createDocument(app, new DocumentBuilder().setTitle(`AutoClipper ${service}`).setVersion('0.2.0').addBearerAuth().build());
  if (config.ENABLE_DOCS) SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'openapi.json' });
  return document;
}
