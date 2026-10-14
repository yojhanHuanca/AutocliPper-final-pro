# Matriz de estado

Entrega: etapa 1 y recorrido prioritario de etapa 2. Estados: **IV** implementado y verificado; **IE** implementado sin verificación externa; **PC** pendiente de configuración; **PD** pendiente de desarrollo. Ver [stage-2.md](stage-2.md) para aceptación y límites; no se contabilizan diseños como funciones implementadas.

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
| Imágenes de aplicación y stack completo | IV | Ver comandos y resultado final en verification.md |
| Publicación etapa 1 en remoto | IV | Privado confirmado mediante API; commit cf6912b publicado con autorización |
| Registro/verificación, login y recuperación de contraseña | IV | SMTP real local, tokens de un uso; aceptación funcional con dos cuentas |
| Google / entrega externa de correo | PD + PC | Sin simulación; requieren implementación/configuración y prueba externa |
| Sesiones/refresh/reutilización/revocación, Argon2id, CSRF | IV | Cookies HttpOnly, rotación, revocación de familia, origen y token CSRF comprobados |
| 2FA/códigos, perfil/preferencias, solicitudes de privacidad | IV | TOTP/recovery reales, revocación de sesiones, CAS y aislamiento; ver identity-security.md |
| Ejecución de exportación/eliminación integral de datos | PD | Solo se registran solicitudes con fulfillment=pending; falta coordinación entre servicios |
| Workspaces/equipos/invitaciones/roles/propiedad | IV | Comprobación servidor, invitación ligada a email, transferencia y restricciones en PostgreSQL |
| Proyectos CRUD, búsqueda y concurrencia | IV | Acceso denegado a otro usuario y versión contra sobrescritura |
| Carpetas/etiquetas/favoritos y paginación por cursor completa | PD | Listado actual acotado a 100 y búsqueda; capacidades adicionales pendientes |
| Upload firmado/multipart/reanudación/confirmación | IV | PUT y multipart de dos partes reales, tamaño firmado, HEAD y SHA-256 final en worker |
| Cuota técnica de almacenamiento y reservas | IV | 11 reservas concurrentes: 10 admitidas y una rechazada; replay no duplica reserva |
| Purga de objetos confirmados y cancelación de trabajos activos | PD | Abortado y limpieza de cargas pendientes implementados; no equivalen a cancelar inspecciones |
| Importación de proveedores / SSRF | PD + PC | Sin importador ni acceso universal anunciado |
| Extracción de audio/transcripción/análisis/segmentos | PD + PC | Candidatos de proveedor documentados; sin credenciales ni resultados IA inventados |
| Diarización/traducción/títulos/hashtags/prompt/costo IA | PD + PC | Dependen del adaptador elegido y sus capacidades reales |
| Render/subtítulos/exportación/descarga video/SRT/VTT | PD | FFmpeg disponible; no existe generación de clips funcional todavía |
| Edición versionada, CAS, revisiones, encuadre/marca/audio | PD | Modelo previsto, no implementado |
| Preview/seguimiento/split-screen/unión de segmentos | PD | Sin promesas de equivalencia o soporte |
| Comentarios/aprobaciones/enlaces de revisión/auditoría | PD | Etapa 4 |
| OAuth social, tokens cifrados, publicación/calendario | PD + PC | Etapa 5, permisos/revisión por proveedor |
| Programación IANA/dedupe/conciliación social | PD | Máquina de estados diseñada, sin envíos reales |
| Planes/consumo/reservas/conciliación/créditos/webhooks | PD | Etapa 6; sin precios ni cobros simulados |
| Proveedor de pagos | PC | Selección requiere entidad, país y necesidades comerciales |
| Notificaciones/correo/preferencias/soporte | PD + PC | SMTP local y preferencia de correo verificados; entrega externa, eventos y soporte pendientes |
| Administración autorizada/ajustes auditados | PD | Ninguna ruta global sin permisos |
| Fairness y cuotas por workspace, workers separados por etapa | PD | Solo concurrencia por instancia y limiter global de inspección |
| Dump y restore PostgreSQL en base temporal | IV | pg_dump/pg_restore y comprobación de migración restaurada; base temporal retirada |
| Restore integral/PITR/retención de negocio | PD | Procedimiento y políticas propuestas, ensayo completo pendiente |
| Carga/seguridad avanzada/trazas/SBOM/producción | PD | Sin capacidad de millones ni resultados de carga anunciados |
| Diagramas, ADR, modelo de amenazas, guía, costos y tesis | IV | Documentación entregada; métricas de tesis sin resultados inventados |
| Primera aceptación funcional de 8 pasos con IA | PD + PC | Cuenta/proyecto/upload/inspección/aislamiento reales disponibles; faltan IA, render y descarga de clip |

Prioridad siguiente: cerrar funciones avanzadas pendientes de etapa 2 y continuar extracción/transcripción/selección/render con proveedor real. No habilitado para producción ni anunciado como plataforma completa.
