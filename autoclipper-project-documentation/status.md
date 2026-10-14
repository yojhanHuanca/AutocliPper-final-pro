# Matriz de estado

Entrega: etapa 1. Estados: **IV** implementado y verificado; **IE** implementado sin verificación externa; **PC** pendiente de configuración; **PD** pendiente de desarrollo. Los diseños escritos no se contabilizan como funciones implementadas.

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
| CI con lint/tipos/tests/build/audit/contratos/Docker | IE | Workflow preparado; ejecución remota no lanzada ni comprobada |
| Imágenes de aplicación y stack completo | IV | Ver comandos y resultado final en verification.md |
| Publicación del trabajo en remoto | PC | Remoto externo detectado; sin push de esta implementación; visibilidad no verificada |
| Registro/verificación, login/reset, Google | PD + PC | Requiere implementación, correo/dominio y clientId Google |
| Sesiones/refresh/reutilización/revocación, Argon2id | PD | Diseño de cookies y CSRF documentado; ninguna sesión funcional |
| 2FA/recuperación, perfil/preferencias, exportar/eliminar datos | PD | Entidades y política previstas |
| Workspaces/equipos/invitaciones/roles/propiedad | PD | No se afirma autorización multiusuario por el prefijo S3 |
| Proyectos/carpetas/etiquetas/búsqueda/favoritos | PD | Sin endpoints de negocio |
| Upload firmado/multipart/recuperación/confirmación y cuotas | PD | Bucket y verificación técnica disponibles; flujo de usuario pendiente |
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
| Notificaciones/correo/preferencias/soporte | PD + PC | SMTP/Postmark candidato; no se envió correo |
| Administración autorizada/ajustes auditados | PD | Ninguna ruta global sin permisos |
| Fairness y cuotas por workspace, workers separados por etapa | PD | Solo concurrencia por instancia y limiter global de inspección |
| Dump y restore PostgreSQL en base temporal | IV | pg_dump/pg_restore y comprobación de migración restaurada; base temporal retirada |
| Restore integral/PITR/retención de negocio | PD | Procedimiento y políticas propuestas, ensayo completo pendiente |
| Carga/seguridad avanzada/trazas/SBOM/producción | PD | Sin capacidad de millones ni resultados de carga anunciados |
| Diagramas, ADR, modelo de amenazas, guía, costos y tesis | IV | Documentación entregada; métricas de tesis sin resultados inventados |
| Primera aceptación funcional de 8 pasos | PD + PC | No satisfecha: faltan identidad/proyectos/upload usuario/IA/render/descarga/aislamiento real |

Prioridad siguiente: identidad, workspaces y permisos de recursos antes de admitir cargas de usuarios. Ver scope.md para la secuencia completa.
