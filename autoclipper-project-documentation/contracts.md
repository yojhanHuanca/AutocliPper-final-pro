# Contratos implementados y política futura

Actualización etapa 2: el OpenAPI del gateway ya reúne los endpoints implementados de identidad, workspaces, proyectos y cargas, con DTO, cookies, CSRF, errores e idempotencia. Los detalles y ejemplos de autenticación están en [stage-2.md](stage-2.md). Las secciones históricas de operación de etapa 1 se mantienen abajo; los mecanismos allí marcados como previstos deben contrastarse con la matriz actual.

Los JSON en `contracts/` se generan desde controladores reales. Registro, sesiones, workspaces, proyectos, carga y derivados explícitos están implementados. `POST /uploads/{id}/processing` admite audio o clip v1; estado/cancelación/descarga viven bajo `/processing/{id}` y el historial bajo `/projects/{id}/processing`. Sus DTO, timestamps y límites están en [stage-3-media.md](stage-3-media.md). No se incluyen endpoints ficticios de IA ni publicación.

| Servicio | Método/ruta | Resultado |
|---|---|---|
| gateway | GET /v1/health/live | 200, `{"status":"ok"}` |
| gateway | GET /v1/health/ready | 200, `{"status":"ok","checks":{}}`; stateless |
| media | GET /v1/health/live | 200 |
| media | GET /v1/health/ready | 200 o 503; checks postgres/redis/storage/ffprobe/ffmpeg/worker |
| media | GET /v1/metrics | Bearer interno requerido, formato Prometheus |

Ejemplo de readiness real:

```json
{"status":"ok","checks":{"postgres":"ok","redis":"ok","storage":"ok","ffprobe":"ok","ffmpeg":"ok","worker":"ok"}}
```

En el borde se genera correlationId UUID y se devuelve en `x-correlation-id`. Los errores no retornan valores de entrada, URLs, tokens, trazas ni detalles de proveedores:

```json
{"code":"RESOURCE_NOT_FOUND","message":"Request could not be completed","correlationId":"d1bf700a-7f1c-4ca2-9b27-a71c62e34517"}
```

Swagger solo se habilita con ENABLE_DOCS=true; no depende implícitamente de NODE_ENV. La API pública de etapa 2 incorpora autenticación funcional, proyectos y cargas, descritos en el OpenAPI del gateway y stage-2.md.

Evento interno de inspección (validación estricta, propiedades adicionales prohibidas):

```json
{"version":1,"taskId":"893fa48b-8dc2-4b48-8c39-9243b756f6df","correlationId":"d1bf700a-7f1c-4ca2-9b27-a71c62e34517"}
```

Cola `autoclipper-media-inspection-v1`; jobId = taskId. Fuente autoritativa del workspace, clave, bytes y ETag: tabla privada del servicio. Project crea intenciones autorizadas; la interfaz de media es privada. El evento no concede permisos ni ejecuta herramientas indicadas por el cliente.

## Políticas de Angular y ampliaciones pendientes

- `/v1` como versión; DTO con allowlist de campos, límites de paginación, filtros/ordenación explícitos y validación estricta. HTTP 409/412 en conflictos de edición con ETag/If-Match; revisiones inmutables.
- Idempotency-Key con scope usuario+workspace+operación, hash de solicitud y resultado persistido para creación de trabajos/exportaciones/publicaciones. Reutilizar clave con otro cuerpo produce 409.
- SSE autenticado por sesión; eventos con ID persistido, `Last-Event-ID`, reconexión y GET de estado como alternativa. Aún no implementado; no inventar progreso.
- Sesiones actuales en cookies HttpOnly, SameSite=Lax, Secure/prefijo __Host- en producción; refresh rotatorio y revocación por familia ante reutilización. No guardar refresh en localStorage. Gateway/business habilitan credentials=true para el origen exacto; multimedia conserva CORS sin cookies porque no publica operaciones de usuario.
- Origin y CSRF firmado se verifican ya en operaciones mutables. Angular envía withCredentials y X-CSRF-Token solo al host de la API; el token preautenticación permite proteger login/registro. Definir dominios/HTTPS antes de producción. Google ya valida issuer/audience/expiry/nonce en servidor; su aceptación con cuenta real y orígenes Cloud sigue pendiente.

Angular consulta la inspección mediante `/v1/uploads/:id`, a través de autorización en project y workspace; la interfaz interna multimedia no se publica. El client ID público de Google está configurado localmente, sin aceptación externa. whisper.cpp local está verificado; Deepgram/Ollama/social/pagos siguen sin configuración o aceptación real.

## Análisis y render desde transcripción

El OpenAPI público y los tipos generados incluyen `/analyses/providers`, `/processing/{id}/analyses`, `/analyses/{id}` y `/analyses/{id}/renders`. Selección y render manual/propuesta son variantes `oneOf`. Errores seguros incluyen TRANSCRIPTION_NOT_CONFIGURED, SELECTION_NOT_CONFIGURED, AI_BUDGET_NOT_AUTHORIZED, LOCAL_TRANSCRIPTION_DURATION_LIMIT e INVALID_SELECTION_REQUEST. Fechas UTC ISO 8601; tiempos de subtítulos absolutos de fuente, segundos; costos USD estimados solo externos. Ver ejemplos, límites y estados en [stage-3-analysis.md](stage-3-analysis.md).

Cola `content-analysis-v1`: evento estricto `{"version":1,"jobId":"UUID"}`; jobId BullMQ = UUID persistido. No contiene texto, URLs, claves de almacenamiento ni instrucciones ejecutables. El worker consulta únicamente su base de datos; la fila guarda fuente/spec/revisiones autoritativas. Contrato privado de operaciones generado en `contracts/analysis.openapi.json`; endpoints internos no se mezclan en el documento público.

## Edición por revisiones

El OpenAPI y los tipos generados añaden creación bajo `/uploads/{id}/edits`, GET/PATCH `/edits/{id}`, historial y revisión específica, restore, renders y exports. Las variantes de subtítulos son `none`, `user` y `transcript`; esta última permite únicamente un analysisId autorizado del mismo upload. PATCH/restore exigen versión actual y devuelven 412 ante conflicto; GET incluye ETag y se valida If-Match cuando está presente. Un render elige `revisionVersion` y su estado incorpora `editorRevisionId`. Plantillas y encuadre son campos cerrados de clip v1 compatibles con solicitudes previas. Listados de borradores/exportaciones están acotados a 50; historial usa cursor beforeVersion. Ejemplos y semántica: [stage-4-editor.md](stage-4-editor.md).

## Colaboración y grants de revisión

Rutas bajo `/edits/{id}`: review, approvals, comments, review-links y audit. Las transiciones exigen version y reviewVersion; aprobar/devolver requieren admin/owner, comentarios y enlaces editor. Comments usa Idempotency-Key, tiempo relativo al clip y borrado CAS; comments/audit paginan por beforeId. Las dos rutas GET `/review-links/{token}` y `/review-links/{token}/video` se marcan `security: []` en el contrato público: el token del path es un grant limitado, no una cookie ni credencial interna. Sus DTO omiten miembros/autores/identificadores de fuentes; video solo firma el MP4 guardado con TTL acotado al grant. Creación devuelve el token una vez; listados/auditoría nunca lo incluyen. Ejemplos, roles y semántica de 404/409/412/429: [stage-4-collaboration.md](stage-4-collaboration.md).

## Pantalla dividida

EditorSpecDto incorpora splitScreen opcional: secondaryUploadId, layout side_by_side/stacked, primaryRatio 0.2–0.8, startSeconds del secundario, shortInput reject/freeze, audio primary/secondary/none y framing opcional. Se admite mediante el editor versionado y se rechaza en POST directo uploads/{id}/processing. ProcessingSpecDto de respuesta conserva la descripción autorizada; PublicSplitScreenDto elimina secondaryUploadId. Las variantes previas clip/audio siguen válidas sin ese campo. La cola continúa enviando solo el taskId versionado; ambas fuentes se consultan desde las bases de sus dueños. Ver ejemplo, límites y política de duración/audio en [stage-4-split-screen.md](stage-4-split-screen.md).

## Pipeline manual en servidor

POST `/uploads/{id}/pipelines` recibe PipelineSpecDto estricto: provider whisper_cpp, language explícito, selection none e intervalo/aspect manual. GET/DELETE `/pipelines/{id}` consulta/cancela; GET `/pipelines/{id}/download` firma video/SRT/VTT. Respuestas acotadas a ocho transiciones, sin claves S3 ni transcripción completa. Idempotency-Key obligatorio al crear, cookie/Origin/CSRF y roles actuales; la idempotencia no sustituye autorización. Un solo POST crea la intención, no cada etapa desde Angular. No admite LLM/pago/URLs/IDs de etapas del cliente. Contratos públicos regenerados y detalles en [stage-3-orchestration.md](stage-3-orchestration.md).

## Consumo de desarrollo

GET `/consumption/workspaces/{id}` y GET `/consumption/workspaces/{id}/ledger` requieren reader vigente; este último pagina por beforeId y limita 50 movimientos. No hay mutaciones públicas de planes/créditos. Los contratos públicos Billing/gateway y tipos generados describen segundos de material por etapa y planes development sin moneda/precio. PipelineStatusDto añade usageState legacy/pending/accepted/rejected. Reserva/conciliación internas usan schemas versionados estrictos en consumption.ts, credencial interna e inbox/outbox; no se publican como rutas de navegador. Manuales mantienen cuotas técnicas pero están fuera del ledger, gate P0 previo a admisión comercial. [Semántica y ejemplos](stage-6-consumption.md).
