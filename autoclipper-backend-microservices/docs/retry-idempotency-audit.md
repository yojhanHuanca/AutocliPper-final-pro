# Idempotencia y recuperación de pipeline/render/export

Revisión de código: 31 de octubre de 2026. Esta nota describe garantías del backend y la prueba fixture añadida; no certifica una ejecución integrada.

## Garantías persistidas

- **Crear pipeline:** Project identifica el replay por `(creator_id,idempotency_key)` y compara `request_hash`. Un advisory lock serializa carreras. Pipeline, primer evento y reserva de workspace se confirman en una transacción. Un replay devuelve el pipeline persistido tras reautorizar el upload, sin repetir preflight de Analysis ni crear otra reserva.
- **Crear render:** Project persiste `processing_requests` y su outbox con clave por creador. El runtime de Media usa el UUID del task como clave primaria y `jobId` determinista en BullMQ; el outbox se puede reenviar tras una respuesta perdida. `submit` acepta el mismo ID solo si workspace, creador y hash coinciden. El lock advisory del worker impide dos renders concurrentes del mismo task.
- **Retry normal de render:** BullMQ admite hasta tres intentos con backoff exponencial. Fallos capturados limpian las claves fijas `clip.mp4`, `audio.wav`, `captions.srt` y `captions.vtt` bajo `workspaces/{workspaceId}/media/derivatives/{taskId}/`; si esa limpieza falla, `cleanup_pending` obliga a reintentarlo.
- **Export/download:** cada GET comprueba con `HeadObject` el tamaño/ETag del artefacto ya registrado y genera una URL firmada de hasta 120 segundos. No crea otro artefacto ni un job de render. Repetir GET puede generar URLs distintas que apuntan al mismo objeto; las ya emitidas no se revocan anticipadamente.

## Hueco de recuperación corregido

Si el worker moría tras iniciar un render pero antes de persistir un resultado terminal, Media podía conservar `processing_tasks.status='running'` con `cleanup_pending=false`. Al recuperar el mismo job, el lock garantizaba exclusión, pero el código anterior no borraba necesariamente objetos parciales antes de volver a ejecutar FFmpeg. La fila `running` bajo un nuevo lock identifica ese intento interrumpido. Ahora Media elimina primero las cuatro claves fijas del task y solo después vuelve a leer la fuente y renderizar. La limpieza no toca el original ni otros IDs; repetir `DeleteObject` en ese prefijo es seguro.

La ejecución sigue siendo **at least once**: un crash después de consumir CPU/FFmpeg puede obligar a renderizar de nuevo. Los nombres de objeto deterministas evitan acumular claves duplicadas y la limpieza elimina restos previos, pero no puede recuperar el coste de CPU ya consumido. El límite de intentos y la salida terminal evitan reintentos infinitos.

## E2E pendiente

`tests/processing-retry-cleanup.test.mjs` simula SQL, lock y S3; verifica que la limpieza preceda a la fuente y se limite al prefijo del task. `tests/derivative-download-idempotency.test.mjs` simula `HeadObject` y firma con credenciales de fixture; verifica que dos GET usen el mismo objeto y no muten SQL ni S3. Las pruebas de Project, Pipeline y contratos son también fixtures. No se ejecutó una caída real del worker entre FFmpeg/PutObject y el commit SQL, ni el ciclo Project outbox → Redis/BullMQ → Media → FFmpeg → S3 → Project, ni una descarga real por URL firmada. Esos E2E requieren un stack aislado con PostgreSQL, Redis, FFmpeg y storage de recuperación. No se usaron datos reales ni proveedores en esta auditoría.
