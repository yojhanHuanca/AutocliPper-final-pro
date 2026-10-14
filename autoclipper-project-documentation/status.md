# Matriz de estado

Entrega: etapas 1–2, multimedia/transcripción local real de etapa 3 y edición versionada de etapa 4. Estados: **IV** implementado y verificado; **IE** implementado sin verificación externa; **PC** pendiente de configuración; **PD** pendiente de desarrollo. Ver [stage-2.md](stage-2.md), [stage-3-media.md](stage-3-media.md), [stage-3-analysis.md](stage-3-analysis.md) y [stage-4-editor.md](stage-4-editor.md) para aceptación y límites; no se contabilizan diseños como funciones implementadas.

| Capacidad | Estado | Evidencia / límite |
|---|---|---|
| Ruta correcta y Git independiente | IV | Inspección inicial, rev-parse y preservación de commit/remoto aparecidos durante el trabajo |
| Separación frontend/backend/infra/documentación | IV | Estructura creada, Angular sin interfaz |
| npm workspaces, NestJS, TypeScript estricto | IV | Instalación lockfile, lint, compilación y pruebas |
| Versiones exactas, imágenes por digest, snapshot Debian | IV | Archivos de configuración y construcción Docker; consultar verification.md |
| PostgreSQL, Redis y S3 local reales | IV | Contenedores y pruebas sin mocks |
| Roles owner/runtime y migraciones reproducibles | IV | Migración repetida, DDL y acceso a otra base denegados |
| API /v1, Swagger, errores seguros, CORS, correlationId | IV | Prueba HTTP y JSON OpenAPI generado |
| Tipos TypeScript para Angular | IV | Generación desde OpenAPI; cliente HttpClient de negocio pendiente |
| Liveness/readiness | IV | Disponibilidad real y falla de binario en integración |
| Inspección de objetos por FFprobe | IV | Video generado, metadatos persistidos, ETag/tamaño/formato validados |
| Jobs BullMQ, outbox y deduplicación | IV | Replay de outbox, reinicio y restauración de entrada de cola perdida |
| Reintentos limitados y errores clasificados | IV | Archivo inválido permanente y objeto ausente tras 3 intentos |
| Limpieza de temporales y S3 privado | IV | Directorio vacío después de trabajos y GET anónimo 403 |
| Métricas/logs y protección de métricas | IV | Scrape autenticado, rechazo 401; tracing distribuido pendiente |
| CI etapa 1 con lint/tipos/tests/build/audit/contratos/Docker | IV | Run 38501990994 aprobado en quality e infrastructure; commit cf6912b |
| CI del recorrido principal de etapa 2 | IV | Run 38509763878 aprobado en quality, infrastructure y business; commit 2a1e5d6 |
| CI de 2FA, perfil y solicitudes de privacidad | IV | Run 38513828115 aprobado en los tres jobs; commit ddf3036 |
| CI del adaptador Google | IV | Run 38515503194 aprobado en los tres jobs; commit d029f74. No equivale a aceptación externa Google |
| CI de audio/recortes/subtítulos aportados/descargas | IV | Run 38572734981 aprobado en los tres jobs; commit cc49427 |
| CI de servicio de análisis y transcripción/render vinculados | IV | Run 38621706578 aprobado en quality, infrastructure y business; commit a392e6d. ASR real acreditado por prueba local opt-in |
| CI de edición versionada, encuadre y plantillas | IV | Run 38629797508 aprobado en los tres jobs; commit 721336e. Editor con ASR real acreditado localmente, sin pesos en CI |
| Imágenes de aplicación y stack completo | IV | Ver comandos y resultado final en verification.md |
| Publicación etapa 1 en remoto | IV | Privado confirmado mediante API; commit cf6912b publicado con autorización |
| Registro/verificación, login y recuperación de contraseña | IV | SMTP real local, tokens de un uso; aceptación funcional con dos cuentas |
| Google validado en servidor | IE + PC | SDK oficial, nonce de un uso, vínculo con prueba y MFA; pruebas con firmas locales explícitas. Client ID público anterior configurado localmente; origen Cloud/login externo sin verificar |
| Entrega externa de correo | PC | SMTP local real verificado; no se probó un proveedor de entrega externa |
| Sesiones/refresh/reutilización/revocación, Argon2id, CSRF | IV | Cookies HttpOnly, rotación, revocación de familia, origen y token CSRF comprobados |
| 2FA/códigos, perfil/preferencias, solicitudes de privacidad | IV | TOTP/recovery reales, revocación de sesiones, CAS y aislamiento; ver identity-security.md |
| Ejecución de exportación/eliminación integral de datos | PD | Solo se registran solicitudes con fulfillment=pending; falta coordinación entre servicios |
| Workspaces/equipos/invitaciones/roles/propiedad | IV | Comprobación servidor, invitación ligada a email, transferencia y restricciones en PostgreSQL |
| Proyectos CRUD, búsqueda y concurrencia | IV | Acceso denegado a otro usuario y versión contra sobrescritura |
| Carpetas/etiquetas/favoritos y paginación por cursor completa | PD | Listado actual acotado a 100 y búsqueda; capacidades adicionales pendientes |
| Upload firmado/multipart/reanudación/confirmación | IV | PUT y multipart de dos partes reales, tamaño firmado, HEAD y SHA-256 final en worker |
| Cuota técnica de almacenamiento y reservas | IV | 11 reservas concurrentes: 10 admitidas y una rechazada; replay no duplica reserva |
| Purga de objetos confirmados y cancelación de inspecciones | PD | Abortado/limpieza de cargas pendientes y cancelación de derivados/análisis implementados; cancelar inspecciones sigue pendiente |
| Importación de proveedores / SSRF | PD + PC | Sin importador ni acceso universal anunciado |
| Extracción de audio WAV | IV | Audio real PCM mono 16 kHz, fuente validada, download autorizado y prueba FFprobe |
| Transcripción local con tiempos e idioma | IV | whisper.cpp/tiny fijados, fuente WAV comprobada, español detectado y aceptación real con MP4/SRT/VTT |
| Servicio de análisis persistente y separado | IV | Base/roles/cola propios, replay/reinicio, cancelación, checksum y tres intentos comprobados |
| Deepgram STT y diarización | IE + PC | Adaptador binario con revisión fijada, presupuesto y resultado incierto protegidos; fixtures HTTP únicamente, sin consumo externo |
| Selección LLM, instrucciones, títulos/hashtags/explicación | IE + PC | Adaptador Ollama y validaciones; falta modelo/servidor e inferencia real. selection=none permite intervalo manual |
| Modelos, prompt y estimación de costo IA | IV parcial + IE | Modelo/hash de ASR real guardados; prompt/version/uso LLM probados con fixtures. Costo externo local 0, cómputo no gratuito |
| Traducción de subtítulos | PD | No hay traductor ni resultados traducidos simulados |
| Orquestación automática de todas las etapas | PD | Intenciones durables vinculadas; el cliente encadena audio/análisis/render y elige manualmente el intervalo cuando selection=none |
| Recorte explícito/render/subtítulos aportados/video/SRT/VTT | IV | MP4 real, texto visible en frame, sidecars y URLs S3 privadas de 120s; no es selección ni transcripción IA |
| Persistencia/recovery/cancelación de derivados/cuota | IV | Outbox, pérdida Redis restaurada, tres intentos máximos, cancelación activa/en cola y cuota conciliada una vez |
| Edición versionada, CAS, revisiones recuperables | IV | PostgreSQL impide modificar revisiones; dos escritores concurrentes, versiones/If-Match obsoletos, ETag a través del gateway y restauración comprobados |
| Encuadre manual y plantillas de subtítulos | IV | Crop normalizado, clean/boxed/bold y posición top/bottom medidos en FFmpeg; exportación usa la revisión elegida, con procedencia de ASR real conservada |
| Marca y mezcla de audio | PD | No se agregaron logos, overlays ni mezcla musical |
| Preview/seguimiento/split-screen/unión de segmentos | PD | Sin promesas de equivalencia o soporte |
| Comentarios/aprobaciones/enlaces de revisión/auditoría | PD | Etapa 4 |
| OAuth social, tokens cifrados, publicación/calendario | PD + PC | Etapa 5, permisos/revisión por proveedor |
| Programación IANA/dedupe/conciliación social | PD | Máquina de estados diseñada, sin envíos reales |
| Planes/consumo/reservas/conciliación/créditos/webhooks | PD | Etapa 6; sin precios ni cobros simulados |
| Proveedor de pagos | PC | Selección requiere entidad, país y necesidades comerciales |
| Notificaciones/correo/preferencias/soporte | PD + PC | SMTP local y preferencia de correo verificados; entrega externa, eventos y soporte pendientes |
| Administración autorizada/ajustes auditados | PD | Ninguna ruta global sin permisos |
| Fairness y workers separados por etapa | IV parcial + PD | Inspector, renderer y análisis separados; cuatro análisis activos/workspace y concurrencia uno. STT/selección comparten worker/cola; fairness completo pendiente |
| Dump y restore PostgreSQL en base temporal | IV | pg_dump/pg_restore y comprobación de migración restaurada; base temporal retirada |
| Restore integral/PITR/retención de negocio | PD | Procedimiento y políticas propuestas, ensayo completo pendiente |
| Carga/seguridad avanzada/trazas/SBOM/producción | PD | Sin capacidad de millones ni resultados de carga anunciados |
| Diagramas, ADR, modelo de amenazas, guía, costos y tesis | IV | Documentación entregada; métricas de tesis sin resultados inventados |
| Primera aceptación funcional de 8 pasos con IA | IV | Cuenta verificada, proyecto/upload, whisper.cpp real, clip subtitulado, estado/download y otro usuario denegado. Intervalo manual; no acredita selección automática |

Prioridad siguiente: marca y colaboración de etapa 4; selección automática con un LLM real permanece pendiente de recursos/proveedor, junto con traducción y orquestación automática. Conservar la aceptación local real de transcripción/edición/render/descarga. Faltan también funciones de etapa 2 enumeradas y el resto del alcance. No habilitado para producción ni anunciado como plataforma completa.
