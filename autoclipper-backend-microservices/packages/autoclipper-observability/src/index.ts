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

const sensitiveLogPaths = [
  'password','token','authorization','cookie','secret','apiKey','api_key','apikey','openaiApiKey','geminiApiKey','OPENAI_API_KEY','GEMINI_API_KEY',
  'clientSecret','client_secret','TWITCH_CLIENT_SECRET','accessToken','access_token','refreshToken','refresh_token','idToken','id_token','csrfToken','csrf_token',
  'url','authorizationUrl','downloadUrl','signedUrl','signed_url','presignedUrl','presigned_url',
  'req.headers.authorization','req.headers.cookie','req.headers["x-service-token"]','req.headers["x-csrf-token"]','req.headers["x-goog-api-key"]','req.headers["x-api-key"]',
  '*.password','*.token','*.authorization','*.cookie','*.secret','*.apiKey','*.api_key','*.apikey','*.openaiApiKey','*.geminiApiKey','*.OPENAI_API_KEY','*.GEMINI_API_KEY',
  '*.clientSecret','*.client_secret','*.TWITCH_CLIENT_SECRET','*.accessToken','*.access_token','*.refreshToken','*.refresh_token','*.idToken','*.id_token','*.csrfToken','*.csrf_token',
  '*.url','*.authorizationUrl','*.downloadUrl','*.signedUrl','*.signed_url','*.presignedUrl','*.presigned_url',
  '*.headers.authorization','*.headers.cookie','*.headers["x-service-token"]','*.headers["x-csrf-token"]','*.headers["x-goog-api-key"]','*.headers["x-api-key"]',
];
const sensitiveLogField=/(?:password|passphrase|token|authorization|cookie|secret|api.?key|url|message|msg|stack)/iu;
function sanitizeLogValue(value:unknown):unknown{
  if(Array.isArray(value))return value.map(sanitizeLogValue);
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,sensitiveLogField.test(key)||/^(?:error|err)$/iu.test(key)?'[REDACTED]':sanitizeLogValue(child)]));
  return value;
}
export function createSafeLogger(destination?:pino.DestinationStream){
  return pino({level:process.env['LOG_LEVEL']??'info',redact:{paths:sensitiveLogPaths,censor:'[REDACTED]'},formatters:{log:object=>sanitizeLogValue(object) as Record<string,unknown>}},destination);
}
export const logger = createSafeLogger();
// Framework messages can embed request data or exception text; never serialize them.
export class ApplicationLogger implements LoggerService {
  constructor(private readonly sink:pino.Logger=logger){}
  log() {}
  error() { this.sink.error({ code: 'FRAMEWORK_ERROR' }); }
  warn() {}
  debug() {}
  verbose() {}
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
    const safeCodes: Record<string, number> = { GOOGLE_NOT_CONFIGURED: 503, TWITCH_OAUTH_NOT_CONFIGURED: 503, TWITCH_ACCOUNT_NOT_LINKED: 409, TWITCH_CHANNEL_EDITOR_REQUIRED: 403, TWITCH_RATE_LIMITED: 429, YOUTUBE_DOWNLOAD_APPROVAL_REQUIRED: 422, KICK_MEDIA_API_UNAVAILABLE: 422, ACCOUNT_LINK_REQUIRED: 409, TRANSCRIPTION_NOT_CONFIGURED:503, OPENAI_API_KEY_MISSING:503, GEMINI_API_KEY_MISSING:503, SELECTION_NOT_CONFIGURED:503, SELECTION_PROVIDER_NOT_SUPPORTED:503, SELECTION_PROVIDER_UNAVAILABLE:503, SELECTION_MODEL_MISMATCH:503, SELECTION_MODEL_NOT_SUPPORTED:503, OPENAI_INVOCATION_LIMIT_REACHED:429, AI_BUDGET_NOT_AUTHORIZED:503, LOCAL_TRANSCRIPTION_DURATION_LIMIT:400, INVALID_SELECTION_REQUEST:400, MANUAL_PROCESSING_NOT_ADMITTED:403, PRIVACY_SNAPSHOT_CHANGED:409, PRIVACY_EXPORT_NOT_PENDING:409, PRIVACY_EXPORT_SCOPE_TOO_LARGE:413 };
    Object.assign(safeCodes, {
      SOCIAL_OAUTH_NOT_CONFIGURED:503,SOCIAL_RECONNECT_REQUIRED:409,SOCIAL_OAUTH_STATE_INVALID:400,SOCIAL_CLIP_NOT_READY:409,
      SOCIAL_CONNECTION_FAILED:502,SOCIAL_OAUTH_TOKEN_INVALID:502,SOCIAL_PROVIDER_REJECTED:502,SOCIAL_PROVIDER_UNREACHABLE:502,SOCIAL_SCOPE_MISSING:502,
      YOUTUBE_IMPORT_BUSY:429,YOUTUBE_DOWNLOAD_TOO_LARGE:413,YOUTUBE_VIDEO_UNAVAILABLE:503,YOUTUBE_DOWNLOAD_TIMEOUT:503,YOUTUBE_DOWNLOAD_FAILED:503,YOUTUBE_DOWNLOADER_NOT_CONFIGURED:503,YOUTUBE_INVALID_MEDIA:503,
      LOCAL_AI_NOT_READY:503,LOCAL_AI_UNAVAILABLE:503,
    });
    const code = typeof explicit === 'string' && safeCodes[explicit] === status ? explicit : codes[status] ?? 'INTERNAL_ERROR';
    const messages:Record<string,string>={
      TRANSCRIPTION_NOT_CONFIGURED:'No hay un proveedor de transcripción disponible. Revisa la configuración del servicio de análisis.',
      OPENAI_API_KEY_MISSING:'La selección automática necesita configurar OPENAI_API_KEY en el entorno privado del backend. La ejecución pagada sigue desactivada hasta que se autorice.',
      GEMINI_API_KEY_MISSING:'La selección automática con Gemini necesita configurar GEMINI_API_KEY en el entorno privado del backend. La ejecución pagada sigue desactivada hasta que se autorice.',
      AI_BUDGET_NOT_AUTHORIZED:'La selección automática está bloqueada: falta autorización de IA pagada o un límite aprobado por trabajo. Puedes usar un intervalo manual.',
      SELECTION_NOT_CONFIGURED:'El proveedor de selección automática no está configurado. Revisa el diagnóstico de proveedores o usa un intervalo manual.',
      SELECTION_PROVIDER_NOT_SUPPORTED:'El proveedor de selección indicado no está admitido por este backend.',
      SELECTION_PROVIDER_UNAVAILABLE:'El proveedor de selección no responde. Espera un momento y vuelve a intentarlo.',
      SELECTION_MODEL_MISMATCH:'El modelo configurado no coincide con la revisión esperada por el servicio.',
      SELECTION_MODEL_NOT_SUPPORTED:'El modelo de selección configurado no está admitido. Configura OPENAI_MODEL o GEMINI_MODEL con un modelo compatible.',
      OPENAI_INVOCATION_LIMIT_REACHED:'Se alcanzó el límite de solicitudes OpenAI de esta ejecución; la solicitud adicional no se envió.',
      TWITCH_OAUTH_NOT_CONFIGURED:'La importación de Twitch no está configurada en este servidor. Contacta al responsable del entorno.',
      TWITCH_ACCOUNT_NOT_LINKED:'Vincula una cuenta de Twitch desde Configuración antes de importar este clip.',
      TWITCH_CHANNEL_EDITOR_REQUIRED:'Vincula una cuenta que sea broadcaster o editor del canal de Twitch.',
      TWITCH_RATE_LIMITED:'Twitch limitó temporalmente la descarga. Espera un minuto y vuelve a intentarlo.',
      YOUTUBE_DOWNLOAD_APPROVAL_REQUIRED:'AutoClipper no importa videos de YouTube desde una URL. Sube un archivo que tengas autorización para usar.',
      KICK_MEDIA_API_UNAVAILABLE:'Kick no ofrece una API pública documentada para importar el video desde una URL. Descarga el clip desde Kick y sube el MP4.',
    };
    Object.assign(messages, {
      SOCIAL_OAUTH_NOT_CONFIGURED:'Falta configurar la aplicación OAuth de la plataforma en el servidor. No se envió ningún video.',
      SOCIAL_RECONNECT_REQUIRED:'Vuelve a conectar tu cuenta antes de enviar el clip.',
      SOCIAL_OAUTH_STATE_INVALID:'La autorización venció o no coincide con esta sesión. Inicia de nuevo la conexión.',
      SOCIAL_CLIP_NOT_READY:'Espera a que termine la exportación del MP4 antes de compartirlo.',
      SOCIAL_CONNECTION_FAILED:'No se pudo completar la conexión con la plataforma.',
      YOUTUBE_IMPORT_BUSY:'Ya hay descargas en curso. Espera unos segundos y vuelve a intentarlo.',
      YOUTUBE_DOWNLOAD_TOO_LARGE:'El video supera el tamaño máximo permitido. Sube un archivo más pequeño.',
      YOUTUBE_VIDEO_UNAVAILABLE:'YouTube no permite acceder a este video. Revisa si es privado, está restringido o fue eliminado.',
      YOUTUBE_DOWNLOAD_TIMEOUT:'La descarga del video superó el tiempo límite. Puedes volver a intentarlo.',
      YOUTUBE_DOWNLOAD_FAILED:'No se pudo descargar el video de YouTube. Revisa su disponibilidad o usa un archivo local.',
      YOUTUBE_DOWNLOADER_NOT_CONFIGURED:'El descargador no está instalado en el servidor. Actualiza la imagen del backend.',
      LOCAL_AI_NOT_READY:'El modelo de IA local todavía no está listo. Inicia el servicio local y verifica el modelo instalado.',
      LOCAL_AI_UNAVAILABLE:'El servicio de IA local no responde. No se hizo una llamada de pago.',
    });
    const nextActions:Record<string,string>={TRANSCRIPTION_NOT_CONFIGURED:'configure_transcription',OPENAI_API_KEY_MISSING:'configure_openai',GEMINI_API_KEY_MISSING:'configure_gemini',AI_BUDGET_NOT_AUTHORIZED:'review_ai_budget',OPENAI_INVOCATION_LIMIT_REACHED:'review_ai_budget',SELECTION_NOT_CONFIGURED:'configure_ai_provider',SELECTION_PROVIDER_NOT_SUPPORTED:'configure_ai_provider',SELECTION_PROVIDER_UNAVAILABLE:'retry_generation',SELECTION_MODEL_MISMATCH:'review_ai_provider',SELECTION_MODEL_NOT_SUPPORTED:'review_ai_provider',TWITCH_OAUTH_NOT_CONFIGURED:'configure_twitch_oauth',TWITCH_ACCOUNT_NOT_LINKED:'link_twitch_account',TWITCH_CHANNEL_EDITOR_REQUIRED:'connect_broadcaster_or_editor_account',TWITCH_RATE_LIMITED:'retry_after_rate_limit',YOUTUBE_DOWNLOAD_APPROVAL_REQUIRED:'upload_authorized_file',KICK_MEDIA_API_UNAVAILABLE:'upload_authorized_file'};
    Object.assign(nextActions,{SOCIAL_OAUTH_NOT_CONFIGURED:'configure_social_oauth',SOCIAL_RECONNECT_REQUIRED:'link_social_account',LOCAL_AI_NOT_READY:'start_local_ai',LOCAL_AI_UNAVAILABLE:'start_local_ai',YOUTUBE_VIDEO_UNAVAILABLE:'check_source_access',YOUTUBE_DOWNLOAD_TOO_LARGE:'upload_authorized_file',YOUTUBE_DOWNLOAD_TIMEOUT:'retry_download',YOUTUBE_DOWNLOAD_FAILED:'retry_download'});
    response.status(status).json({ code, message: messages[code] ?? 'Request could not be completed', ...(nextActions[code]?{nextAction:nextActions[code]}:{}), correlationId: response.locals['correlationId'] });
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
