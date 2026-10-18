# Desarrollo local

La guía de la entrega actual está en [stage-2.md](stage-2.md): se requiere combinar `compose.yaml` y `compose.business.yaml` para disponer de autenticación, workspaces y proyectos. Los comandos de infraestructura/pruebas multimedia de este documento también sirven para comprobar esas dependencias por separado.

Requisitos: Docker Desktop con motor Linux, Compose, Git. Para desarrollo en host: Node **24.21.0**, npm **11.12.1**, FFmpeg/FFprobe. Windows observado tenía Node 25.9.0: usar `nvm use 24.21.0` si ya está instalado o contenedores. No es necesario cambiar globalmente el Node del equipo.

## Arranque completamente en contenedores

Desde la raíz de este repositorio, PowerShell:

```powershell
Set-Location autoclipper-infrastructure
node setup-local.mjs
docker compose -f compose.yaml -f compose.business.yaml --profile app up -d --build
docker compose -f compose.yaml -f compose.business.yaml --profile app ps
```

`setup-local.mjs` crea los archivos de entorno ignorados por Git con secretos aleatorios e invoca setup-stage2.mjs para las aplicaciones de negocio. Nunca imprime valores. Falla si los archivos iniciales ya existen: usar `setup-stage2.mjs` para ampliar una instalación de etapa 1. Si una creación se interrumpe parcialmente, recuperar explícitamente los archivos antes de reintentar. No borrar volúmenes para solucionar contraseñas sin confirmar que no contienen datos necesarios.

Servicios: gateway [http://localhost:3000/v1/health/live](http://localhost:3000/v1/health/live), media [http://localhost:3001/v1/health/ready](http://localhost:3001/v1/health/ready). Swagger en `/docs` y JSON en `/openapi.json`, habilitados solo para desarrollo. PostgreSQL `127.0.0.1:15432`, Redis `127.0.0.1:16379`, S3 `127.0.0.1:19000`. Todos los puertos publicados se limitan a loopback.

PostgreSQL inicializa roles y base únicamente al crear el volumen. El servicio one-shot `migrate-media` aplica migraciones antes del worker y termina con código cero. `storage-init` crea el bucket privado y la política para abortar multipart incompleto al día. Redis usa AOF y noeviction; alcanzar el límite provoca backpressure y requiere intervención/capacidad, no expulsión silenciosa de jobs.

## Desarrollo y pruebas en host

```powershell
Set-Location autoclipper-infrastructure
docker compose up -d postgres redis storage
Set-Location ../autoclipper-backend-microservices
npm ci
npm run verify
node --env-file=.env.media apps/autoclipper-media-processing-service/dist/infrastructure/migrate.js
node --env-file=.env.media scripts/storage-init.mjs
node --env-file=.env.media --test --test-concurrency=1 tests/integration/*.test.mjs
```

En terminales separadas:

```powershell
node --env-file=.env.gateway apps/autoclipper-api-gateway/dist/main.js
node --env-file=.env.media apps/autoclipper-media-processing-service/dist/main.js
```

Si el Node del host no es 24, los mismos comandos `node` pueden ejecutarse con `npm exec --yes --package=node@24.21.0 -- node ...`. No usar `npm run start:*` sin cargar el entorno correspondiente.

## Prueba real dentro de Docker

```powershell
# Desde autoclipper-infrastructure; app habilita el inicializador requerido.
docker compose --profile app stop media
docker compose --profile app --profile test run --build --rm verification
docker compose --profile app up -d --no-build
```

Se detiene el worker de aplicación para que no consuma trabajos de la prueba; no ejecutar en un entorno compartido con usuarios o trabajos reales. El verificador usa su propio worker y puerto interno 3101. Se prueba migración doble, permisos de base, S3 privado, FFmpeg real, cola/outbox, reinicio, pérdida de entrada Redis, duplicados, fallos permanentes/transitorios, limpieza y readiness con FFprobe ausente. **No es la aceptación funcional con cuentas y clips IA**. Las pruebas fallan si faltan dependencias o entorno; no se omiten silenciosamente.

## Variables

| Variable | Uso |
|---|---|
| HOST / PORT | Dirección de escucha; loopback en host, 0.0.0.0 dentro del contenedor |
| NODE_ENV / ENABLE_DOCS | Entorno y exposición explícita de Swagger |
| CORS_ORIGIN | Un único origen Angular permitido; nunca `*` con cookies |
| DATABASE_URL | Rol runtime, solo base media |
| MIGRATION_DATABASE_URL | Rol owner; solo migraciones/pruebas, no worker de producción |
| REDIS_URL | Redis autenticado; `rediss` para TLS |
| S3_ENDPOINT / S3_REGION / S3_BUCKET | Endpoint compatible S3 y bucket privado |
| S3_ACCESS_KEY / S3_SECRET_KEY | Credencial local; gestor de secretos en producción |
| S3_FORCE_PATH_STYLE | true para RustFS local |
| INTERNAL_TOKEN | Autorización de `/v1/metrics`; al menos 32 caracteres |
| WORKER_CONCURRENCY | 1–8, por proceso; valor local 2 |
| MAX_PROBE_BYTES | Máximo descargable; 100 MiB predeterminado, tope de configuración 1 GiB |
| MAX_VIDEO_SECONDS | Duración permitida; 3600 segundos local |
| PROBE_TIMEOUT_MS | Timeout de descarga y timeout separado de FFprobe; 30000 ms cada uno |
| FFPROBE_PATH / FFMPEG_PATH | Binarios confiables administrados por el operador, nunca por el usuario |
| TEMP_DIR | Directorio de temporales; `/tmp/media` en contenedor |
| TEST_TEMP_DIR | Directorio de fixtures solo en pruebas |

La validación falla sin mostrar valores sensibles. Las credenciales generadas son hexadecimales y no requieren escaping en URLs. Si se suministran otras credenciales, codificar sus componentes URL correctamente.

Google es opcional: `GOOGLE_CLIENT_ID` público en `.env` de infraestructura para Docker o `.env.identity` para ejecución nativa. Los ejemplos lo dejan vacío. `setup-stage2.mjs` lo traslada al crear un archivo identity nuevo si está definido en infraestructura; conserva archivos ya existentes. No se necesita ni se admite un secreto OAuth para validar ID tokens. Configuración y prueba externa pendientes se explican en [google-identity.md](google-identity.md).

La entrega multimedia agrega el contenedor `renderer`, sin puerto publicado, y `MEDIA_WORKERS=render` separado del inspector (`inspection`, predeterminado). `RENDER_TIMEOUT_MS` limita FFmpeg, por defecto 180000 ms. El perfil `app` incluye ambos workers. Para ejecutar la suite aislada contra las dependencias locales, detener primero `project`, `media` y `renderer`; restaurar el stack al terminar. Recorrido, comandos y evidencia: [stage-3-media.md](stage-3-media.md).

## Migraciones y contratos

```powershell
npm run db:generate
npm run build
node --env-file=.env.media apps/autoclipper-media-processing-service/dist/infrastructure/migrate.js
npm run openapi:export
npm run client:types
```

Revisar siempre SQL generado. `client:types` genera tipos de OpenAPI, no una aplicación Angular ni un cliente HTTP completo. Angular podrá consumirlos mediante HttpClient y sus interceptores. No editar a mano los archivos generados.

Parada conservando datos: `docker compose --profile app down`. No usar `down -v` sobre datos necesarios. Los logs pueden consultarse con `docker compose logs --tail 100 media gateway`; no publicar `.env` ni la salida completa de `docker compose config`, porque expande secretos.

## ASR local opcional

Ejecutar `node setup-stage2.mjs` en infraestructura agrega credenciales nuevas de análisis sin imprimirlas ni sustituir archivos existentes. `node setup-analysis-model.mjs` descarga/verifica solo tiny (74.1 MiB). Usar `compose.analysis-local.yaml` junto con compose.yaml/compose.business.yaml para habilitarlo. El stack base no descarga modelos ni habilita pago. Comandos de construcción, prueba real y configuración: [stage-3-analysis.md](stage-3-analysis.md).

La suite de recuperación de análisis usa proveedores explícitos de tests con PostgreSQL/Redis/S3 reales. Detener `analysis` antes de `run --rm analysis-verification` con compose.business-tests.yaml; restaurarlo con el override local después. No ejecutar sus fixtures contra otro worker de análisis activo.

La migración Project `0005_editor_revisions` se ejecuta por el migrador one-shot al recrear el stack. La suite business incluye concurrencia del editor, recuperación de revisión, permisos y MP4 de una revisión anterior. La suite local-ai agrega edición desde la transcripción real y rechazo de análisis de otro upload; requiere el opt-in/modelo local descrito arriba. La suite integration mide encuadre y plantillas sobre frames de FFmpeg. Comandos completos y límites: [stage-4-editor.md](stage-4-editor.md).

La migración `0006_editor_collaboration` incorpora comentarios, aprobaciones, auditoría y enlaces hash-only. `tests/acceptance/collaboration.test.mjs` usa cuentas example.test/Mailpit, equipo reader/editor, video real y grants sintéticos; no envía invitaciones a personas reales. Si se encadenan suites de cuentas desde una IP reutilizada por Docker, respetar la ventana real de 20 verificaciones/10 minutos antes de repetir ASR; no borrar contadores ni desactivar límites. [Guía y comandos de colaboración](stage-4-collaboration.md).

Pantalla dividida añade migraciones Project `0007_split_screen` y Media `0003_split_screen`. Detener workers propios antes de integración y construir imágenes coherentes para aplicar ambas; actualizar todos los consumidores antes de habilitar nuevas specs. Tests nuevos: split-screen-filter (frames/audio reales), split-screen-runtime (dos hashes/recuperación/fallos/cancelación) y aceptación split-screen (permisos/revisión/cuota/grant). Los fixtures de cuentas de esa aceptación son SQL explícito y no acreditan SMTP; account-upload y local-ai conservan la verificación real. La prueba de colaboración agota intencionalmente 50 lecturas públicas/minuto; la aceptación posterior espera el vencimiento natural si recibe 429. [Evidencia y comandos de split](stage-4-split-screen.md).

Orquestación usa Project `0008_pipelines`, sin servicio nuevo. `pipeline-verification` exige Project detenido y comprueba transacciones/recuperación/roles con estados de etapa explícitos de test; local-ai añade la petición única con whisper.cpp real. Los verificadores de negocio tienen `profiles: [test]`: `run --rm <verificador>` los selecciona explícitamente; `up --profile app` no debe iniciarlos. No ejecutar simultáneamente dos comandos Compose que puedan recrear sus dependencias compartidas. Restaurar solo aplicación con compose.yaml/business/analysis-local, sin el override business-tests, para recuperar el endpoint S3 de descarga del host. [Guía completa de orquestación](stage-3-orchestration.md).

Billing de desarrollo usa puerto loopback 3007, base/roles propios y `0000_consumption`; Project añade `0009_pipeline_usage`. Ejecutar setup-stage2.mjs agrega únicamente credenciales ausentes y prepara .env.billing sin imprimirlas. Detener Project antiguo antes de migrar/recrear la aplicación; nuevas intenciones requieren usage_spec, las anteriores permanecen legacy. Límites confiables DEV_PROCESSING_SECONDS_PER_MONTH/DEV_ACTIVE_PIPELINES crean versiones nuevas sin alterar asignaciones existentes. Las APIs públicas de consumo son de lectura, y los fixtures de ledger no son inferencias reales. [Guía, comandos, resultados y alcance manual/legacy](stage-6-consumption.md).

Project admite `PROCESSING_ADMISSION_MODE=development` por defecto. `commercial` rechaza nuevos POST manuales de audio/análisis/render/exportación con 403 `MANUAL_PROCESSING_NOT_ADMITTED`; conserva consultas, descargas, cancelación, drafts e historial y permite pipelines sujetos al ledger. Reiniciar Project aplica el modo; nunca enviarlo desde Angular. `admission-verification` requiere Project detenido, usa HTTP y workers reales y puede ejecutar ASR opt-in con `ADMISSION_REAL_ASR=true`; `pipeline-verification` comprueba también el modo commercial con estados explícitos. [Inventario, comandos y límites](stage-6-commercial-admission.md). El nombre del modo no habilita pagos ni producción.

La administración mínima read-only añade Identity `0004_administration` y `0005_admin_audit_grant_context`, sin base ni runtime nuevo. El operador usa la conexión owner con `scripts/admin-operator.mjs`; la aplicación solo puede leer grants. Requiere cuenta verificada/MFA y elevación de sesión de cinco minutos; no hereda roles workspace. `admin-verification` usa cuentas/jobs sintéticos explícitos, servicios reales y CLI owner solo en el verificador; debe ejecutarse con Project activo y revoca/comprueba sus grants al terminar. No recrear servicios mientras el frontend esté en E2E: coordinar ventana y conservar volúmenes. [CLI, OpenAPI, permisos, límites y evidencia](stage-7-administration-read-only.md).
