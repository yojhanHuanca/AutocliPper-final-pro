# AutoClipper

## Run locally (Docker Desktop)

The complete local stack runs with Docker Compose, including the Angular web app, API, workers, PostgreSQL, Redis, and private object storage. Use the existing web address `http://localhost:4200`; do not start another frontend server.

### Requirements

- Windows 10/11, Docker Desktop with the Linux engine and WSL 2 backend.
- Docker Compose v2 (`docker compose`).
- Git and PowerShell.
- Loopback ports 4200, 3001–3005, 3007, 11025, 15432, 16379, 19000, and 19025 available.

No host Node.js, npm, or FFmpeg installation is needed. The first build downloads pinned images and builds the app. A temporary Node container only creates ignored local credentials.

### First startup

Clone the private repository and check Docker in PowerShell:

```powershell
git clone https://github.com/yojhanHuanca/AutocliPper-final-pro.git
Set-Location .\AutocliPper-final-pro
docker info
docker compose version
```

Create local credentials once. The script refuses to overwrite existing `.env` files; skip it on an existing configured checkout:

```powershell
$repoRoot = (Get-Location).Path
docker run --rm --mount "type=bind,source=$repoRoot,target=/workspace" `
  --workdir /workspace/autoclipper-infrastructure `
  node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 `
  node setup-local.mjs
```

Start the stack from the infrastructure directory:

```powershell
Set-Location .\autoclipper-infrastructure
$compose = @('-f', 'compose.yaml', '-f', 'compose.business.yaml', '-f', 'compose.web.yaml', '--profile', 'app')
docker compose @compose up -d --build
docker compose @compose ps
```

Wait for services to become healthy. Open the app at [http://localhost:4200](http://localhost:4200), API health at [http://localhost:3005/v1/health/ready](http://localhost:3005/v1/health/ready), API docs at [http://localhost:3005/docs](http://localhost:3005/docs), and the development inbox at [http://localhost:19025](http://localhost:19025).

### Secrets, stopping, and resuming

Generated `.env` files are local and ignored by Git. Do not share their values or the output of `docker compose config`. Paid AI is off by default; ordinary startup makes no paid provider calls. Do not enable Ollama or paid calls during collaborator onboarding.

Stop containers while keeping local data:

```powershell
docker compose @compose down
```

Do not add `-v`: that removes database, Redis, and object-storage volumes. Resume with `docker compose @compose up -d` (add `--build` only when intentionally rebuilding changed images). Coordinate rebuilds of an in-use stack with the team because they can recreate services.

For troubleshooting, inspect only the needed service and review logs before sharing:

```powershell
docker compose @compose logs --tail 100 web gateway media
```

Privacidad: [aporte del perfil propio de Identity](autoclipper-project-documentation/privacy-lifecycle.md) y nuevo [aporte de membresías actuales de Workspace](autoclipper-project-documentation/privacy-contributions.md), con contraseña/MFA, CSRF, idempotencia y recibos auditables sin otra copia del payload. Son parciales; la solicitud global sigue pendiente. El inventario versionado cubre ahora 58 tablas de seis bases y sus dependencias con objetos/grants/backups; eliminación coordinada y política de retención pendientes. La activación del runtime compartido requiere una ventana coordinada con frontend.

[CI de privacidad 39170681668](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/39170681668) aprobó los tres jobs para `b50850a`: 34 unitarias/HTTP, 34 infraestructura, regresión de negocio y aceptación aislada del aporte mediante 26 peticiones HTTP, sin fallos ni omisiones.

Primera presentación: [arquitectura y entrada pública Cloudflare](autoclipper-project-documentation/cloudflare-architecture.md), con contexto, servicios, seis bases, procesamiento y despliegue previsto. La propuesta separa Tunnel web/API de medios privados mediante R2/Worker; implementación y aceptación de nube pendientes. [Ensayo de recuperación cifrada](autoclipper-project-documentation/recovery-drill.md): restauración aislada local verificada con seis bases, objetos y replay de inspección; no acredita RPO/RTO de producción.

[CI final del ensayo 39158379956](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/39158379956) aprobó quality/infrastructure/business para `7f86090`: 31 unitarias/HTTP, 34 infraestructura y todas las suites de negocio, administración, análisis, orquestación y admisión, sin fallos ni omisiones; restore cifrado remoto aprobado.

Último incremento backend: [administración mínima de solo lectura](autoclipper-project-documentation/stage-7-administration-read-only.md), con grants por operador, MFA/reauth y alcance por permiso/workspace. [CI 39089615290](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/39089615290) aprobó los tres jobs para `457ff9d`: 30 unitarias/HTTP, 34 infraestructura, 62 negocio, diez administración y suites de recuperación/admisión sin fallos ni omisiones. Acciones administrativas, configuración global y soporte siguen pendientes.

Nueva implementación independiente del backend. **Entrega actual: admisión de procesamiento por configuración del servidor**, sobre planes de desarrollo versionados y ledger de nuevos pipelines. `PROCESSING_ADMISSION_MODE=development` conserva las rutas manuales bajo cuotas técnicas; `commercial` bloquea la creación manual de audio/análisis/render/exportación y permite pipelines sujetos al ledger. Consultas, descargas, cancelación e historial permanecen autorizados, sin consumo retroactivo. Billing mide segundos de material por etapa y tiene base propia, sin pagos, precios ni créditos públicos. Conserva orquestación audio → ASR local → render, intervalo manual explícito, edición versionada, pantalla dividida, colaboración, identidad, workspaces y cargas. Selección automática LLM, traducción y diarización externa real siguen pendientes. [Política, inventario de rutas y evidencia](autoclipper-project-documentation/stage-6-commercial-admission.md).

Ver [pantalla dividida, políticas y evidencia](autoclipper-project-documentation/stage-4-split-screen.md), [colaboración](autoclipper-project-documentation/stage-4-collaboration.md) y [edición/API](autoclipper-project-documentation/stage-4-editor.md). Verificación propia: 26 unitarias/HTTP, 34 infraestructura, 7 recuperación de análisis con fixtures explícitos, 14 aceptación conjunta y 6 del flujo con ASR real; los conteos incluyen padres. [CI 38669973228](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/38669973228) aprobó los tres jobs para `02003a2`, incluida la regresión completa de 55 tests de negocio. La corrección del 429 entre pruebas está documentada. CI usa fixtures de análisis; whisper.cpp real se verificó localmente. Marca, mezcla avanzada y preview siguen pendientes. [Backlog priorizado para lanzamiento](autoclipper-project-documentation/launch-backlog.md), sin declarar producción lista.

Identidad incluye 2FA TOTP, recuperación, perfil y solicitudes de privacidad. El adaptador Google valida credenciales en servidor; su prueba externa con una cuenta real sigue pendiente. Ver [límites de Google](autoclipper-project-documentation/google-identity.md) y [seguridad de identidad](autoclipper-project-documentation/identity-security.md).

La [entrega de orquestación](autoclipper-project-documentation/stage-3-orchestration.md) pasó localmente 27 unitarias/HTTP, 34 infraestructura, 7 recuperación de análisis con fixtures, 7 orquestación con estados explícitos, 7 del flujo whisper.cpp real y una de frontera HTTP. Incluye SIGKILL únicamente del proceso orquestador aislado; los fixtures no acreditan inferencia. [CI 38673694628](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/38673694628) aprobó los tres jobs para `c38afee`, incluida la regresión completa de 56 tests de negocio y las dos suites de siete fixtures.

El [incremento de consumo](autoclipper-project-documentation/stage-6-consumption.md) pasó 28 unitarias/HTTP, 7 de ledger/aislamiento, 8 de recuperación de orquestación, 7 del flujo con whisper.cpp real y 2 de alcance manual/legacy/frontera HTTP. Los eventos/estados explícitos de tests no se presentan como IA real. [CI 38677679024](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/38677679024) aprobó los tres jobs para `1069fb0`, incluidos 62 tests de negocio. El bloqueo posterior de rutas manuales cierra esa vía de admisión fuera del ledger; los demás [gates de lanzamiento](autoclipper-project-documentation/launch-backlog.md) siguen pendientes.

La etapa 1 está publicada en `cf6912b`, con CI remoto aprobado. La entrega de etapa 2 y sus verificaciones se describen en [stage-2.md](autoclipper-project-documentation/stage-2.md). Swagger público en [gateway](http://localhost:3005/docs); correo de desarrollo en [Mailpit](http://localhost:19025).

La [admisión por modo](autoclipper-project-documentation/stage-6-commercial-admission.md) quedó cerrada con [CI 38837993047](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/38837993047) para `c9e57aa`, los tres jobs aprobados: 29 unitarias/HTTP, 34 infraestructura, 62 negocio, 7 Analysis fixtures, 8 orquestación commercial y 8 admisión HTTP, sin fallos/omisiones. Se verificó además una matriz local con whisper.cpp real y ledger; CI usa fixtures explícitos y no descarga modelos. Bootstrap limpio de seis bases/doce roles sin reinicios aprobado. El stack local conserva development por defecto; el modo commercial no habilita pagos ni producción.

- [Guía local](autoclipper-project-documentation/local-development.md)
- [Arquitectura y decisiones](autoclipper-project-documentation/architecture.md)
- [Estado por requisito](autoclipper-project-documentation/status.md)
- [Evidencia de verificaciones](autoclipper-project-documentation/verification.md)
- [Plan de entregas](autoclipper-project-documentation/scope.md)

El frontend Angular se sirve desde Docker Compose en http://localhost:4200; no hace falta iniciar un servidor de desarrollo aparte. No se reutilizaron archivos, secretos ni historia del proyecto Java anterior. Por autorización posterior del propietario se reutilizó únicamente su client ID público de Google, en configuración local ignorada. El repositorio remoto es privado; los commits se publican con autorización del usuario, sin desplegar producción.
