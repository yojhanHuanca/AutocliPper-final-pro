# Aporte parcial de atribución de Project

Fecha: 18 de octubre de 2026. El endpoint `POST /v1/auth/privacy-requests/{id}/project-export` agrega un manifiesto parcial del servicio Project a la solicitud propia. No completa una exportación integral, no cambia el estado global de la solicitud y no exporta bytes de archivos.

## Alcance devuelto

El alcance versionado `project-attribution-v1` devuelve UUID, estado y fechas de los registros que el solicitante creó o escribió: proyectos, cargas, procesamiento, análisis, pipelines y revisiones de editor. Incluye tamaño/MIME de sus cargas, estado de limpieza, estado/fin de trabajos, código de error clasificado y acción/versión de revisiones escritas por la persona. Cada referencia queda ligada a `subjectId`; el límite agregado es 500 registros.

Se omiten nombres y texto de proyectos/borradores, `spec`, resultados y transcripciones, comentarios/aprobaciones de otras personas, identidad de pares, workspace IDs, claves de objetos multipart/S3, hashes de fuente, URLs de media y contenido de objetos. Las referencias reflejan autoría histórica local: una membresía actual de Workspace no da acceso a la autoría de otra persona y la salida no afirma ser dueña de un workspace o de todos sus medios. Este aporte permite correlacionar metadatos de Project con dueños Media/Analysis en el futuro; aún no transfiere sus datos.

## Autorización y consistencia

La ruta pública exige sesión/cookie propia, CSRF/origen, contraseña actual, factor MFA fresco si aplica e `Idempotency-Key` UUID. Identity valida que la solicitud propia sea `export` y esté pendiente, luego emite una capacidad aleatoria de corta duración, con hash guardado, sesión y access token vigentes, request, alcance, clave y correlación. La capacidad vence en 30 segundos. Identity confirma la transacción antes de la llamada HTTP al dueño. Project no acepta `userId`, IDs de proyecto ni workspace elegidos por el cliente: valida la capacidad con Identity y consulta su propia base.

Una sola sentencia SQL construye todas las listas de negocio para que compartan la misma instantánea local. El recibo hash-only y la auditoría inmutable se guardan en Project, sin copia del payload. La misma clave y contenido devuelve el mismo recibo; una diferencia devuelve 409 `PRIVACY_SNAPSHOT_CHANGED` y conserva historia. Más de 500 referencias devuelve 413 `PRIVACY_EXPORT_SCOPE_TOO_LARGE` sin lista truncada ni recibo. Fallar Project no produce un recibo exitoso; reintentar requiere nueva prueba sensible con la misma clave. Ninguna rama marca la solicitud global como `completed`.

Las migraciones nuevas son Identity `0008_project_privacy_capabilities.sql` y Project `0010_privacy_exports.sql`. El [catálogo por dueños](../autoclipper-backend-microservices/privacy/data-map.json) cubre ahora 61 tablas de seis bases; los nuevos registros de autoridad se excluyen del export público.

## Verificación

La aceptación integrada ejecuta Identity y Project HTTP reales contra bases PostgreSQL aisladas. Fixtures sintéticos acreditan aislamiento de sujetos, MFA/CSRF/sesión, rechazo de capacidades vencidas o de alcance incorrecto, autoría frente a otro usuario, replay, cambio de snapshot, recuperación si Project reinicia, inmutabilidad de recibos/auditoría, y rechazo del límite sin guardar payload. El resultado no acredita una base o almacenamiento de negocio reales. La aceptación externa con OAuth Twitch o políticas de retención no está relacionada con este endpoint.
