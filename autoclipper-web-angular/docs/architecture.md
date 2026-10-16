# Arquitectura del frontend

Se reorganizó la primera implementación antes de ampliar el producto. Las páginas ya no viven en una carpeta global `pages`, ni existe un `api.ts` con todos los dominios. TypeScript, plantillas y estilos están separados; no se generaron carpetas vacías para una arquitectura futura.

```text
src/app/
  core/
    auth/                  sesión/cookies del usuario autenticado
    config/                URL pública y token de exploración de diseño
    contracts/             gateway.generated.d.ts y alias de tipos
    guards/                guard de sesión
    http/                  transporte, CSRF, interceptor, errores seguros
  layouts/
    public/                navegación y footer del sitio público
    workspace/             navegación adaptable y selector de espacios
    administration/        estructura global prevista, sin operaciones
  features/
    auth/                  rutas, página y cliente de registro/recuperación
    dashboard/             composición de inicio y datos del usuario
    projects/              cliente, colección reutilizable y detalle/cargas
    editor/                cliente, estado local, página y componentes
    consumption/           cliente de lectura, ledger y página
    settings/              cliente de cuenta/seguridad y página
    workspaces/            estado de selección, guard y alta inicial
    administration/        estructura informativa, no cliente ficticio
    landing/               relato, fotografía y escenas enlazadas
  shared/ui/               iconos genéricos y página no encontrada
```

Cada feature expone sus propias rutas lazy. El router raíz compone layouts y guards, sin importar páginas de forma ansiosa. Los clientes de dominio exponen operaciones con nombre y DTO generados; solo ellos conocen las rutas HTTP. `ApiTransport` concentra GET/POST/PATCH/DELETE y respuestas con cabeceras, sin conceptos de proyecto/editor/consumo.

`core` y `shared` no importan features ni layouts: existe una prueba de ese límite. `shared/ui` no almacena negocio. Los layouts pueden usar infraestructura y el selector de espacios. Una feature no importa páginas o estado interno de otra; dashboard compone deliberadamente la colección pública de proyectos y el alta de espacios. Los contratos públicos son tipos, no entidades compartidas con el backend.

`SessionStore` contiene identidad de sesión; `WorkspaceStore` conserva únicamente los espacios autorizados y selección del estudio. El estado del editor se provee **en la página**, se destruye al salir y se comparte solo con sus componentes: rail, preview, timeline, inspector de composición, subtítulos, historial, revisión y exportaciones. No hay un store global con todo el producto. La colección de proyectos conserva su estado por instancia; las consultas de proyecto/consumo descartan resultados de una selección anterior.

Las credenciales viven en cookies HttpOnly. CSRF y la coordinación de renovación viven en memoria. Dos mutaciones concurrentes comparten adquisición de CSRF; dos respuestas 401 comparten refresh. Las solicitudes de autenticación fallidas no se repiten automáticamente, para evitar reenviar contraseñas o consumir códigos de recuperación. El retry conserva cuerpo y clave de idempotencia. El interceptor compara la base absoluta y su frontera de path; las URLs firmadas usan `fetch` con `credentials: omit`, sin interceptor ni token CSRF.

Las descargas también se obtienen con `credentials: omit`, se convierten temporalmente en Blob y se descargan localmente; no se abre la URL de almacenamiento en una navegación que pueda llevar cookies del mismo hostname en desarrollo. El reproductor lleva `crossorigin="anonymous"`. Un grant vencido requiere solicitar otro enlace; no existe un fallback con credenciales.

La UI no cambia políticas de admisión. `MANUAL_PROCESSING_NOT_ADMITTED` se explica como bloqueo del servidor, preservando consulta/descargas anteriores, sin reintentos por rutas alternativas. El pipeline sigue su contrato de una intención durable; Angular no encadena por su cuenta audio/ASR/render. El polling se detiene al destruir la vista o ante un fallo y no inventa porcentajes.

Los estilos base pertenecen al feature/layout que los utiliza. Primitivas y breakpoints coordinados viven en `styles.css`, con capas `base`, `components`, `responsive`: el orden de carga de una ruta lazy no puede sobreescribir un breakpoint móvil. Se usan clases con responsabilidad concreta y `ViewEncapsulation.None` deliberadamente para esas reglas compartidas. Evoluciones futuras deben conservar las capas o aislar por completo un componente con sus propios breakpoints; no introducir overrides globales arbitrarios.

Los tokens aprobados de blanco/Cobalto viven en `:root` de `styles.css`. No se mantiene un store global ni un selector para propuestas ya resueltas.

## Entrada pública prevista

El usuario eligió Cloudflare como futura entrada del tráfico público de web, API y medios. Es un requisito de arquitectura para la presentación; no hay un despliegue realizado por este frontend ni dominios de producción definidos aquí. El entorno local continúa usando su configuración existente.

La base pública de API se carga desde `public/config.json` por entorno. Las capacidades temporales de almacenamiento proceden del servidor y se consumen separadas de la API, sin cookies ni CSRF; el frontend no reescribe host, query ni firmas ni introduce un proxy arbitrario. La adaptación de URLs firmadas, orígenes CORS, cargas y límites de medios para esa entrada debe cerrarse mediante contratos del backend antes de configurarla en producción.

Los subtítulos aportados tienen un componente de frases y un modelo que valida tiempos absolutos dentro del clip, longitud y presencia de texto. No se pide escribir JSON ni copiar identificadores de análisis: se conserva la transcripción autorizada que ya está vinculada al borrador.

Pendientes de UX/componentización: edición de subtítulos directamente sobre el timeline, selección visual de segunda fuente, más granularidad en seguridad/privacidad, thumbnails de video persistentes cuando exista su contrato, listado/reanudación multipart y experiencia administrativa cuando existan permisos globales y contratos estables. Estos pendientes no bloquean la separación actual ni se ocultan como funciones completas.

El ciclo de acentos es estado local de la landing; nunca modifica `:root`. El controlador recibe un scheduler y libera su único temporizador en pausa, movimiento reducido y destrucción. El snapshot de contrato público dentro del frontend permite generar/verificar tipos sin depender de cambios centrales todavía sin commit. `contracts:sync` es la actualización explícita; `contracts:check` detecta divergencias.
