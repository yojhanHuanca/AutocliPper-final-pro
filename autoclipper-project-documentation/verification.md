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
