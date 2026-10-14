# Contratos implementados y política futura

Actualización etapa 2: el OpenAPI del gateway ya reúne los endpoints implementados de identidad, workspaces, proyectos y cargas, con DTO, cookies, CSRF, errores e idempotencia. Los detalles y ejemplos de autenticación están en [stage-2.md](stage-2.md). Las secciones históricas de operación de etapa 1 se mantienen abajo; los mecanismos allí marcados como previstos deben contrastarse con la matriz actual.

Los JSON en `contracts/` se generan desde controladores reales. Registro, sesiones, workspaces, proyectos y carga están implementados; no se incluyen endpoints ficticios de render, IA ni publicación.

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

Cola `autoclipper-media-inspection-v1`; jobId = taskId. Fuente autoritativa del workspace, clave, bytes y ETag: tabla privada del servicio. Solo operadores/pruebas internas crean task+outbox por ahora. El evento no concede permisos ni ejecuta herramientas indicadas por el cliente.

## Políticas de Angular y ampliaciones pendientes

- `/v1` como versión; DTO con allowlist de campos, límites de paginación, filtros/ordenación explícitos y validación estricta. HTTP 409/412 en conflictos de edición con ETag/If-Match; revisiones inmutables.
- Idempotency-Key con scope usuario+workspace+operación, hash de solicitud y resultado persistido para creación de trabajos/exportaciones/publicaciones. Reutilizar clave con otro cuerpo produce 409.
- SSE autenticado por sesión; eventos con ID persistido, `Last-Event-ID`, reconexión y GET de estado como alternativa. Aún no implementado; no inventar progreso.
- Sesiones actuales en cookies HttpOnly, SameSite=Lax, Secure/prefijo __Host- en producción; refresh rotatorio y revocación por familia ante reutilización. No guardar refresh en localStorage. Gateway/business habilitan credentials=true para el origen exacto; multimedia conserva CORS sin cookies porque no publica operaciones de usuario.
- Origin y CSRF firmado se verifican ya en operaciones mutables. Angular envía withCredentials y X-CSRF-Token solo al host de la API; el token preautenticación permite proteger login/registro. Definir dominios/HTTPS antes de producción. Google sigue pendiente: su futura validación de issuer/audience/expiry/nonce será de servidor.

Angular consulta la inspección mediante `/v1/uploads/:id`, a través de autorización en project y workspace; la interfaz interna multimedia no se publica. Proveedores de Google/IA/social/pagos siguen sin configurar.
