# Modelo de amenazas

Estado actual: identidad, sesiones, CSRF, 2FA, perfil, solicitudes de privacidad, workspaces y autorización de recursos implementados y probados en etapa 2; ver stage-2.md e identity-security.md. No desplegado en producción ni abierto a Internet. La ejecución integral de privacidad y la configuración final de producción siguen pendientes. La tabla siguiente conserva el análisis inicial de etapa 1; la matriz de estado actual prevalece sobre sus pendientes históricos.

| Amenaza | Control existente | Trabajo pendiente |
|---|---|---|
| Filtración de secretos | .env ignorados, generación aleatoria, Docker build excluye entorno, errores/logs sin cuerpos/headers/URLs, redacción Pino | Secret manager, rotación, IAM mínimo y detección de secretos en CI |
| Movimiento entre servicios | Base media con owner/runtime separados, runtime sin DDL ni acceso a postgres | Bases/roles por nuevos servicios; prueba bidireccional de aislamiento |
| Acceso a otro workspace | Prefijo S3 consistente con fila de trabajo, ninguna creación pública | Autenticación, membresía comprobada por servidor y pertenencia de todos los recursos |
| SSRF y playlist maliciosa | No se aceptan URLs; objeto solo del bucket configurado; FFprobe permite únicamente protocolos/formatos locales seleccionados | Importadores con DNS/IP checks, conexión anclada, redirecciones revalidadas, límites y pruebas; negar importaciones hasta entonces |
| Ejecución de comandos | execFile sin shell, argumentos estáticos, binarios solo por configuración del operador | Render spec versionado, allowlist completa, sandbox de mayor aislamiento antes de archivos de usuarios |
| Archivo grande / bomba multimedia | HEAD+ETag+If-Match, lectura acotada, bytes exactos, límites de dimensiones/duración, maxBuffer/max_alloc/timeouts, CPU/memoria/PIDs/tmpfs Docker | Análisis de amenazas del parser, política de codecs y formatos adicionales; antivirus si el riesgo lo exige |
| Exposición de objetos | Bucket privado, GET anónimo denegado en prueba; sin URLs públicas persistidas | URLs firmadas cortas por recurso autorizado, checksums, multipart y cuotas |
| Duplicación de jobs | task+outbox transaccionales, ID estable, resultado terminal persistido, dedupe de cola | Idempotencia por intención de usuario y por render/publicación; inbox entre servicios |
| Pérdida de Redis / reinicio | PostgreSQL autoritativo, reconciliación paginada, Redis AOF noeviction, BullMQ stalled | Backups coordinados, pruebas de corte durante etapa activa y pérdida de host |
| Inyección en IA | No hay IA activa ni herramientas ejecutables desde transcripciones | Tratar transcript como dato, prompts versionados, salida JSON validada y tiempos dentro del video |
| Abuso de métricas / CORS | Métricas Bearer con comparación de tiempo constante; origen exacto; puertos loopback | Red privada/TLS, sesión y CSRF, rate limits distribuidos al habilitar identidad |
| Dependencias vulnerables | Versiones exactas/lock, imágenes por digest, audit local y CI | Escáner de imágenes/SBOM, revisiones periódicas y pruebas al actualizar |

## Límites importantes

- El prefijo workspace no es prueba de autorización del usuario. Solo operadores autorizados y pruebas crean trabajos en esta etapa.
- Runtime y owner separados reducen permisos de base. La credencial S3 local es administrativa para bootstrap; no trasladarla a producción.
- FFprobe analiza archivos no confiables con código nativo. El contenedor tiene usuario no privilegiado, filesystem de solo lectura, tmpfs limitado, sin capabilities y sin privilegios nuevos. Esto reduce impacto, no demuestra ausencia de vulnerabilidades ni elimina la necesidad de aislar la red del worker en producción.
- La cancelación cooperativa por usuario y cuotas por workspace no están implementadas. El apagado espera finalizar trabajos acotados por timeout. Un cierre forzado puede dejar temporales hasta que desaparezca el tmpfs; recuperación y limpieza tras caída del host necesitan prueba adicional.
- No se confía en la extensión/MIME como evidencia de video: FFprobe debe reconocer formato y streams admitidos. No se permite FFmpeg arbitrario ni URLs del cliente.

## Comprobaciones antes de producción

Revisar identidad/2FA/sesiones y aislamiento ya probados; completar fairness y cuotas comerciales; limitar rutas administrativas por permisos explícitos; TLS y secretos externos; revisar IAM, egreso/red del worker y parser; restaurar backup en entorno aislado; medir carga con datos autorizados. Estas son condiciones pendientes de lanzamiento, no una habilitación para producción.
