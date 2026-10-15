# AutoClipper

Nueva implementación independiente del backend. **Entrega actual: orquestación durable en servidor de audio → ASR local → render**, a partir de una única petición y un intervalo manual explícito. Incluye reservas, recuperación y cancelación entre etapas. Conserva edición versionada, pantalla dividida de dos fuentes autorizadas, plantillas, comentarios, aprobaciones y enlaces revocables, conectados a whisper.cpp real. Incluye identidad, workspaces, proyectos, carga segura y exportación privada. Se verificó cuenta → upload → inspección → audio → IA real → edición/composición → clip → descarga y denegación a otro usuario. Selección automática LLM, traducción y diarización externa real siguen pendientes.

Ver [pantalla dividida, políticas y evidencia](autoclipper-project-documentation/stage-4-split-screen.md), [colaboración](autoclipper-project-documentation/stage-4-collaboration.md) y [edición/API](autoclipper-project-documentation/stage-4-editor.md). Verificación propia: 26 unitarias/HTTP, 34 infraestructura, 7 recuperación de análisis con fixtures explícitos, 14 aceptación conjunta y 6 del flujo con ASR real; los conteos incluyen padres. [CI 38669973228](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/38669973228) aprobó los tres jobs para `02003a2`, incluida la regresión completa de 55 tests de negocio. La corrección del 429 entre pruebas está documentada. CI usa fixtures de análisis; whisper.cpp real se verificó localmente. Marca, mezcla avanzada y preview siguen pendientes. [Backlog priorizado para lanzamiento](autoclipper-project-documentation/launch-backlog.md), sin declarar producción lista.

Identidad incluye 2FA TOTP, recuperación, perfil y solicitudes de privacidad. El adaptador Google valida credenciales en servidor; su prueba externa con una cuenta real sigue pendiente. Ver [límites de Google](autoclipper-project-documentation/google-identity.md) y [seguridad de identidad](autoclipper-project-documentation/identity-security.md).

La [entrega de orquestación](autoclipper-project-documentation/stage-3-orchestration.md) pasó localmente 27 unitarias/HTTP, 34 infraestructura, 7 recuperación de análisis con fixtures, 7 orquestación con estados explícitos, 7 del flujo whisper.cpp real y una de frontera HTTP. Incluye SIGKILL únicamente del proceso orquestador aislado; los fixtures no acreditan inferencia. CI de su nuevo SHA se registra tras verificarlo.

La etapa 1 está publicada en `cf6912b`, con CI remoto aprobado. La entrega de etapa 2 y sus verificaciones se describen en [stage-2.md](autoclipper-project-documentation/stage-2.md). Swagger público en [gateway](http://localhost:3000/docs); correo de desarrollo en [Mailpit](http://localhost:19025).

- [Guía local](autoclipper-project-documentation/local-development.md)
- [Arquitectura y decisiones](autoclipper-project-documentation/architecture.md)
- [Estado por requisito](autoclipper-project-documentation/status.md)
- [Evidencia de verificaciones](autoclipper-project-documentation/verification.md)
- [Plan de entregas](autoclipper-project-documentation/scope.md)

El frontend Angular permanece separado y no se implementa aquí. No se reutilizaron archivos, secretos ni historia del proyecto Java anterior. Por autorización posterior del propietario se reutilizó únicamente su client ID público de Google, en configuración local ignorada. El repositorio remoto es privado; los commits se publican con autorización del usuario, sin desplegar producción.
