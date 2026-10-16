# Evidencia de verificación — etapa 1

Registro histórico de la primera entrega. Posteriormente el usuario autorizó publicación y continuación: cf6912b fue subido al remoto privado, con CI remoto 38501990994 aprobado. La evidencia funcional ampliada está en stage-2.md; la etapa 1 dejó de estar limitada a cambios sin publicar.

Fecha de trabajo: 13 de octubre de 2026, America/Lima. Algunos logs de contenedores usan UTC del 14 de octubre; no son otra fecha de entrega. Resultados obtenidos ejecutando comandos reales en este workspace, sin proveedores simulados de infraestructura o multimedia.

## Entorno y aislamiento del proyecto

`Get-Location` confirmó `C:\estudio\4_ciclo\proyecto\AutocliPper-final-pro`. La inspección inicial encontró carpeta vacía, ningún AGENTS.md aplicable en sus ancestros y `git rev-parse` sin repositorio padre. Se ejecutó `git init --initial-branch=main` en esta ruta. No se abrió ni modificó el proyecto Java anterior.

Durante el trabajo inicial apareció el commit 66097ec y un remoto GitHub desde otra sesión. Se conservaron. Esa entrega inicial no hizo push; la comprobación de privacidad y publicación posterior autorizadas se registran arriba.

`node --version`, `npm --version`, `docker --version`, `docker compose version`, `ffmpeg -version`, `psql --version` identificaron el entorno. Docker estaba detenido y `docker desktop start` permitió usar el motor Linux. Node del host 25.9.0 emitió advertencias de engines; Node 24.21.0 se utilizó explícitamente para pruebas y es el runtime Docker.

## Comandos y resultados

| Comando / comprobación | Resultado observado |
|---|---|
| `npm ci` desde lockfile | Instalación reproducida; versión npm 11.12.1; sin secretos |
| `npm run verify` | Lint, build estricto y 6 pruebas unitarias/HTTP aprobadas |
| `npm exec --yes --package=node@24.21.0 -- node --test tests/*.test.mjs` | Las mismas 6 pruebas aprobadas sobre el runtime fijado |
| `npm run db:generate` | Esquema coincide con migración versionada; sin cambios adicionales |
| `node --env-file=.env.media .../dist/infrastructure/migrate.js` | Migración PostgreSQL aplicada; repetición idempotente también comprobada por integración |
| `node --env-file=.env.media scripts/storage-init.mjs` | Bucket privado y lifecycle multipart configurados realmente |
| `npm exec --yes --package=node@24.21.0 -- node --env-file=.env.media --test --test-concurrency=1 tests/integration/*.test.mjs` | 10 subcasos reales aprobados; el runner informa 11 tests contando el padre |
| `npm run openapi:export` y `npm run client:types` | Contratos gateway/media y tipos generados sin conectarse a proveedores |
| `npm audit --audit-level=moderate` | Cero vulnerabilidades reportadas después de corregir el loader de desarrollo |
| `docker compose --profile app --profile test config --quiet` | Compose válido, sin imprimir entorno expandido |
| `docker compose --profile app build media` | Imagen con Node 24 y FFmpeg 5.1.9 construida; base por digest y snapshot Debian fijo |
| `docker compose --profile app up -d --no-build` | PostgreSQL/Redis/S3, migrador, inicializador, gateway y media arrancaron; one-shots código cero |
| GET `/v1/health/ready` en 3000 y 3001 | HTTP 200; media comprobó postgres, redis, storage, ffmpeg, ffprobe y worker |
| `docker compose exec -T media id` | uid=1000(node), gid=1000(node) |
| `docker compose exec -T media ffprobe -version` | FFprobe 5.1.9-0+deb12u1 |
| `pg_dump -Fc` → `pg_restore --no-owner --role=autoclipper_media_owner` en base temporal | Restauró 1 migración y 0 tasks residuales; base y dump temporales eliminados |
| `git check-ignore` para los 3 archivos de entorno | Ignorados correctamente |
| Comparación de secretos locales generados con archivos candidatos a Git | 72 archivos comprobados en esa revisión, cero coincidencias; no se imprimieron valores |
| `git diff --check` | Sin errores de whitespace en cambios rastreados |

## Verificación final Linux/Docker

Se ejecutaron `docker compose --profile app --profile test build media verification`, parada del worker de aplicación, `docker compose --profile app --profile test run --rm verification` y posterior `docker compose --profile app up -d --no-build`.

**Resultado: 10 subcasos aprobados, cero fallos; el runner informa 11 tests incluyendo el padre.** Duración informada del runner: 37.66 segundos. Dependencias reales: PostgreSQL 18.6, Redis 8.2.10, RustFS 1.0.1 y FFmpeg/FFprobe 5.1.9 bajo Node 24.21.0. La prueba de Windows usó FFmpeg 8.1.1 y también pasó.

Al terminar, gateway/media/postgres/redis figuraban healthy; storage estaba en ejecución; migración e inicialización de bucket terminaron con código 0. El verificador efímero se eliminó y media volvió a arrancar. La construcción y pruebas locales no constituyen ejecución del workflow en GitHub.

## Casos reales de integración

1. Migrar dos veces; denegar CREATE al runtime y CONNECT a otra base.
2. Subir objeto privado y comprobar GET anónimo 403.
3. Crear task+outbox antes de iniciar worker; obtener metadatos de MP4 real generado: azul, 320×240, 2 segundos.
4. Reentregar outbox de un trabajo completado sin duplicar ejecución.
5. Detener worker, persistir trabajo y recuperarlo al arrancar otro proceso.
6. Simular pérdida de entrada Redis dejando estado autoritativo en PostgreSQL; reconciliar y completar.
7. Rechazar texto que no es video y ETag cambiado, con fallo permanente en el primer intento.
8. Objeto ausente: tres intentos con backoff y estado final failed.
9. Denegar métricas sin token, permitir scrape autorizado y verificar directorio de temporales vacío.
10. FFprobe ausente: liveness 200 y readiness 503 sin secretos.

Los fixtures se generan por FFmpeg, no se descargan contenidos de terceros, no contienen voces/personas y se limpian junto con sus filas/jobs/objetos. Reiniciar un worker entre trabajos no es una prueba de caída del host durante un render activo: ese ensayo sigue pendiente.

## Incidencias corregidas

- Defaults booleanos Zod y refinamiento de URL que podía lanzar fuera de safeParse: corregidos y cubiertos por pruebas que impiden exponer valores sensibles.
- Recuperación de jobs cuyo outbox estaba marcado entregado pero cuya entrada Redis faltaba: añadido reconciliador paginado y prueba real.
- Tipado del servidor HTTP incompatible con la firma NestJS: corregido; build posterior exitoso.
- Drizzle Kit arrastraba esbuild 0.18.20 vulnerable. Override acotado a 0.25.12; resolución aislada de manifests, nuevo lock, instalación limpia, generación Drizzle y auditoría sin hallazgos. No se usó `npm audit fix --force` ni downgrade destructivo. El loader continúa deprecado y deberá revisarse al actualizar Drizzle Kit.
- La revisión automática rechazó una limpieza manual en bloque de node_modules/lockfile. Se resolvió sin solicitar permisos ni repetir esa eliminación: resolución de dependencias en directorio temporal y `npm ci`.
- La primera consulta al snapshot por HTTPS encontró ausencia de certificados de sistema en la imagen slim. Se usó HTTP con validación criptográfica de las firmas APT, sin desactivar autenticación; la consulta posterior confirmó el paquete exacto. La descarga inicial del snapshot fue lenta; la capa queda cacheada al completar la imagen.
- Un intento del verificador con `docker compose run --no-build` fue rechazado porque `run` no admite esa opción; se corrigió a `run --rm` con la imagen ya construida y la prueba Linux pasó.

## Pendientes al cierre histórico de etapa 1

Flujo de cuenta → proyecto → upload autorizado → IA real → clip subtitulado → descarga y denegación a otro usuario; correo/Google/IA/social/pagos; carga/fairness por workspace; CSRF/sesiones/2FA; cancelación cooperativa; caída durante etapa activa; restauración integral de objetos/Redis/PITR; escaneo de imágenes/SBOM; producción y CI remoto. No hay resultados de tesis, clientes, ventas ni promesas de capacidad.

## Entrega de análisis, 14 de octubre de 2026

Ver [evidencia y comandos de análisis](stage-3-analysis.md). Pasaron localmente 23 tests unitarios/HTTP (lint/build incluidos), 19 de infraestructura, 35 de negocio, 7 de recuperación de análisis con proveedor explícito de tests y 5 del pipeline con whisper.cpp real. Los conteos del runner incluyen padres; no se suman mocks como inferencias reales. La primera aceptación de ocho pasos está verificada con cuenta/email local real, video sintético autorizado, ASR local real, intervalo manual, clip subtitulado, estado/descargas y aislamiento. Selección LLM/Deepgram externos, traducción y calidad de tesis siguen pendientes. CI de esta entrega se registra después de publicarla y comprobar su ejecución; los runs anteriores no acreditan estos cambios.

CI posterior verificado para `a392e6d709cf4361c461e06de1634f5b1b04d500`: [run 38621706578](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/38621706578), quality/infrastructure/business concluyeron success, incluida la suite persistente de análisis con fixtures explícitos. Esta CI no descarga pesos ni ejecuta ASR real; la aceptación de ASR se ejecutó localmente dos veces, la segunda con imágenes finales.

## Entrega de edición versionada, 14 de octubre de 2026

Ver [evidencia y comandos de edición](stage-4-editor.md). Pasaron 25 tests unitarios/HTTP, 23 de infraestructura, 41 de negocio tras corregir el ETag del gateway, 7 de recuperación de análisis con proveedor explícito de fixtures y 6 del pipeline local con whisper.cpp real. Los conteos incluyen padres. Se comprobó concurrencia CAS, recuperación inmutable y render de una revisión anterior con encuadre/estilo medidos sobre el MP4; la aceptación ASR añadió conservación de procedencia y rechazo de análisis de otro upload. Contratos y tipos regenerados; el generador valida referencias y evita modificar contratos de servicio al componer el gateway. Auditoría npm sin vulnerabilidades reportadas. CI de esta entrega se registra tras comprobar su ejecución, sin atribuirle runs de entregas anteriores.

CI comprobado para `721336eb947677e431b1656a31197fbaba878fb6`: [run 38629797508](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/38629797508), quality/infrastructure/business success, incluidos contratos actuales y recuperación de análisis con fixtures explícitos. El ASR real continúa siendo una aceptación local opt-in. Stack propio restaurado healthy y 193 archivos revisados sin coincidencias con secretos locales.

## Entrega de colaboración sobre editor

Ver [evidencia de colaboración](stage-4-collaboration.md). Pasaron 25 unitarias/HTTP y la suite completa de negocio de 49; tras fijar la fecha de firma S3 se reconstruyeron las imágenes y pasaron nuevamente ocho de colaboración y seis del pipeline whisper.cpp real. Una repetición previa de ASR recibió 429 al verificar cuenta, antes de inferencia; se respetó la ventana real y no se borraron contadores. Se probaron lector sin escritura, comentarios temporales/idempotencia/borrado CAS, revisión/aprobación concurrentes y obsoletas, reset tras editar/restaurar, auditoría inmutable y grants de lectura revocables/expirables, sin autores/correos de equipo ni acceso general. La URL S3 real vence dentro del grant. Contratos/tipos regenerados y auditoría npm de construcción sin vulnerabilidades reportadas. CI del SHA de esta entrega se registra después de comprobar sus tres jobs.

CI comprobado para `93dfc02bff39fd3323b2cb7d03e18def3f29218c`: [run 38638350096](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/38638350096), quality/infrastructure/business success, incluidos contratos y las regresiones de infraestructura/negocio/recuperación de análisis. CI no ejecuta ASR real; ese resultado sigue respaldado por la suite local opt-in. Stack propio restaurado healthy y 199 archivos sin coincidencias con secretos locales.

## Entrega de pantalla dividida

Ver [evidencia completa de split](stage-4-split-screen.md). Pasaron 26 unitarias/HTTP, nueve nativas de frames/audio, 34 de infraestructura real, siete de recuperación de análisis con fixtures explícitos, 14 de aceptación conjunta y seis con whisper.cpp real. La primera suite completa de 55 tuvo 53 aprobadas y un subcaso/padre fallidos por el límite público agotado intencionalmente en la suite anterior; se corrigió únicamente la espera natural en pruebas y se repitió colaboración+split. También se corrigió una ruta secundaria relativa respecto al cwd de FFmpeg y se repitió infraestructura con TEMP_DIR relativo, además de ASR/aceptación con las imágenes finales. Se comprobaron ambos SHA, secundario ajeno/modificado/ausente, revisión anterior/cuota, cancelación/limpieza, grants sin IDs de fuente y bloqueo al enviar solo el proyecto secundario a papelera. CI del SHA se registra tras verificarlo. Backlog de lanzamiento actualizado; sin producción ni nuevas compras.

CI comprobado para `02003a20f3e9fc1f09f64829963ba241c91b1abc`: [run 38669973228](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/38669973228), quality/infrastructure/business success. Se consultaron los logs de los jobs: 26 unitarias/HTTP, 34 infraestructura, 55 negocio y siete de recuperación de análisis, cero fallos y cero omisiones. La suite completa de negocio sí quedó aprobada en esta ejecución posterior de CI. No ejecuta ASR real; ese resultado sigue respaldado por la aceptación local opt-in. Stack restaurado healthy, modelos conservados y 209 archivos revisados sin coincidencias con secretos locales antes de publicar.

## Orquestación durable con intervalo manual

Ver [evidencia y límites](stage-3-orchestration.md). Pasaron lint/build/contratos y 27 unitarias/HTTP (también en Node 24.21.0), 34 de infraestructura, siete de recuperación de Analysis con proveedor explícito, siete de orquestación con estados explícitos, siete del flujo local whisper.cpp real y una de frontera HTTP. Una única petición orquestó audio/ASR/render reales, conservó procedencia/subtítulos y denegó a otro usuario; cancelación terminó sin crear render posterior. El SIGKILL se ejecutó solo contra el proceso orquestador de tests, después de commit y con estados de etapa declarados; comprobó replay sin duplicar hijos/reservas. La aceptación opt-in real no se presenta como ensayo de caída durante inferencia. Se probaron roles revocados, plazo/papelera, límites y conciliación, historial SQL inmutable y cancelación entre etapas. Incidencias de ejecución y repetición aislada registradas en la guía, sin ocultar fallos iniciales. La regresión completa de negocio y CI del nuevo SHA se registran después de verificarlas. No se descargaron modelos adicionales ni se habilitó selección LLM, producción o pago.

CI comprobado para `c38afeefac150aad1dc1b30060186852f4d38a06`: [run 38673694628](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/38673694628), quality/infrastructure/business success. Logs consultados: 27 unitarias/HTTP, 34 infraestructura, 56 negocio, siete recuperación de Analysis y siete orquestación, cero fallos/omisiones. Las dos últimas usan fixtures explícitos; CI no descarga modelos ni acredita inferencia real. Stack restaurado healthy con ASR local y endpoint S3 del host; 219 archivos sin coincidencias con secretos locales antes de publicar.

## Ledger de consumo y planes de desarrollo

Ver [evidencia/unidad/política/alcance](stage-6-consumption.md). Pasaron 28 unitarias/HTTP en Node24.21 (lint/build/contratos), siete ledger/aislamiento de cinco bases, ocho orquestación con estados explícitos y Billing real, siete whisper.cpp reales con consumo por duración confirmada, y dos de frontera/alcance manual/legacy. Reserva y decisiones de admisión idempotentes; eventos desordenados/duplicados, plan inmutable, cupos, cancelación/fallo, SIGKILL del propio proceso tras outbox y pérdida de acuse tras commit remoto comprobados. El nuevo subcaso real validó nueve movimientos, consumo único y reservas cero al terminar/cancelar. La última reconstrucción del verificador solo añadió la prueba de alcance: manuales reales fuera del ledger y metadata histórica explícita ligada a MP4 real conservan lectura/descarga sin retrocargo. No se anuncia cuota comercial global; ese gate P0 queda en backlog. No hay precios, pagos, nuevos modelos o producción. La regresión completa y CI exacta se registran tras comprobarlas.

CI comprobada para `1069fb006723eb71b53620d323b46b5765d1813d`: [run 38677679024](https://github.com/yojhanHuanca/AutocliPper-final-pro/actions/runs/38677679024), quality/infrastructure/business success. Logs: 28 unitarias/HTTP, 34 infraestructura, 62 negocio, siete Analysis fixtures y ocho orquestación fixtures, cero fallos/omisiones. ASR real se acredita localmente, no por CI. Stack restaurado healthy incluido Billing; 235 archivos sin coincidencias con secretos locales antes de publicar.
