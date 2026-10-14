# Contratos implementados y política futura

Los JSON en `contracts/` se generan desde los controladores reales. No se incluyen endpoints de registro, carga, render ni publicación que aún no existen.

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

Swagger solo se habilita con `ENABLE_DOCS=true`; no depende implícitamente de NODE_ENV. La API de esta etapa solo admite lecturas operativas. No hay contrato de autenticación funcional todavía.

Evento interno de inspección (validación estricta, propiedades adicionales prohibidas):

```json
{"version":1,"taskId":"893fa48b-8dc2-4b48-8c39-9243b756f6df","correlationId":"d1bf700a-7f1c-4ca2-9b27-a71c62e34517"}
```

Cola `autoclipper-media-inspection-v1`; jobId = taskId. Fuente autoritativa del workspace, clave, bytes y ETag: tabla privada del servicio. Solo operadores/pruebas internas crean task+outbox por ahora. El evento no concede permisos ni ejecuta herramientas indicadas por el cliente.

## Contratos previstos para Angular (pendientes)

- `/v1` como versión; DTO con allowlist de campos, límites de paginación, filtros/ordenación explícitos y validación estricta. HTTP 409/412 en conflictos de edición con ETag/If-Match; revisiones inmutables.
- Idempotency-Key con scope usuario+workspace+operación, hash de solicitud y resultado persistido para creación de trabajos/exportaciones/publicaciones. Reutilizar clave con otro cuerpo produce 409.
- SSE autenticado por sesión; eventos con ID persistido, `Last-Event-ID`, reconexión y GET de estado como alternativa. Aún no implementado; no inventar progreso.
- Sesiones previstas en cookies HttpOnly/Secure y SameSite según dominios; refresh rotatorio, revocación por familia ante reutilización. No guardar refresh en localStorage. CORS actual tiene credentials=false porque todavía no hay sesiones.
- Antes de habilitar cookies: definir dominio público, permitir origen exacto con credentials=true, validar Origin en operaciones mutables y exigir token CSRF vinculado a sesión. Angular enviará credenciales y encabezado X-CSRF-Token; no confiar solo en CORS o SameSite. Google se validará en servidor (issuer, audience, expiry, nonce), nunca por email enviado por el navegador.

No exponer inspección técnica a Angular hasta implementar membresías, pertenencia del recurso y reservas de cuota. Proveedores externos siguen sin configurar.
