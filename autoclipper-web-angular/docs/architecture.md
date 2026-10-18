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
    collaboration/         cliente de revisión, enlaces limitados y vista pública
    consumption/           cliente de lectura, ledger y página
    settings/              cliente de cuenta/seguridad y página
    workspaces/            estado de selección, guard y alta inicial
    administration/        estructura informativa, no cliente ficticio
    landing/               relato, fotografía y escenas enlazadas
  shared/ui/               iconos genéricos y página no encontrada
```

Cada feature expone sus propias rutas lazy. El router raíz compone layouts y guards, sin importar páginas de forma ansiosa. Los clientes de dominio exponen operaciones con nombre y DTO generados; solo ellos conocen las rutas HTTP. `ApiTransport` concentra GET/POST/PATCH/DELETE y respuestas con cabeceras, sin conceptos de proyecto/editor/consumo.

`core` y `shared` no importan features ni layouts: existe una prueba de ese límite. `shared/ui` no almacena negocio. Los layouts pueden usar infraestructura y el selector de espacios. Una feature no importa páginas o estado interno de otra; editor consume el cliente público de colaboración para sus acciones de revisión, y la vista externa reutiliza ese cliente sin acoplarse al editor autenticado. Dashboard compone deliberadamente la colección pública de proyectos y el alta de espacios. Los contratos públicos son tipos, no entidades compartidas con el backend.

`SessionStore` contiene identidad de sesión; `WorkspaceStore` conserva únicamente los espacios autorizados y selección del estudio. El estado del editor se provee **en la página**, se destruye al salir y se comparte solo con sus componentes: rail, preview, timeline, inspector de composición, subtítulos, historial, revisión y exportaciones. No hay un store global con todo el producto. La colección de proyectos conserva su estado por instancia; las consultas de proyecto/consumo descartan resultados de una selección anterior.

Las credenciales viven en cookies HttpOnly. CSRF y la coordinación de renovación viven en memoria. Dos mutaciones concurrentes comparten adquisición de CSRF; dos respuestas 401 comparten refresh. Las solicitudes de autenticación fallidas no se repiten automáticamente, para evitar reenviar contraseñas o consumir códigos de recuperación. El retry conserva cuerpo y clave de idempotencia. El interceptor compara la base absoluta y su frontera de path; las URLs firmadas usan `fetch` con `credentials: omit`, sin interceptor ni token CSRF. Los grants públicos de revisión usan un contexto anónimo de lectura, sin cookies ni refresh.

Las descargas también se obtienen con `credentials: omit`, se convierten temporalmente en Blob y se descargan localmente; no se abre la URL de almacenamiento en una navegación que pueda llevar cookies del mismo hostname en desarrollo. El reproductor lleva `crossorigin="anonymous"`. Un grant vencido requiere solicitar otro enlace; no existe un fallback con credenciales.

La UI no cambia políticas de admisión. `MANUAL_PROCESSING_NOT_ADMITTED` se explica como bloqueo del servidor, preservando consulta/descargas anteriores, sin reintentos por rutas alternativas. El pipeline sigue su contrato de una intención durable; Angular no encadena por su cuenta audio/ASR/render. El polling se detiene al destruir la vista o ante un fallo y no inventa porcentajes.

Los estilos base pertenecen al feature/layout que los utiliza. Primitivas y breakpoints coordinados viven en `styles.css`, con capas `base`, `components`, `responsive`: el orden de carga de una ruta lazy no puede sobreescribir un breakpoint móvil. Se usan clases con responsabilidad concreta y `ViewEncapsulation.None` deliberadamente para esas reglas compartidas. Evoluciones futuras deben conservar las capas o aislar por completo un componente con sus propios breakpoints; no introducir overrides globales arbitrarios.

Los tokens aprobados de blanco/Cobalto viven en `:root` de `styles.css`. No se mantiene un store global ni un selector para propuestas ya resueltas.

## Entrada pública prevista

El usuario eligió Cloudflare como futura entrada del tráfico público de web, API y medios. Es un requisito de arquitectura para la presentación; no hay un despliegue realizado por este frontend ni dominios de producción definidos aquí. El entorno local continúa usando su configuración existente.

La base pública de API se carga desde `public/config.json` por entorno. Las capacidades temporales de almacenamiento proceden del servidor y se consumen separadas de la API, sin cookies ni CSRF; el frontend no reescribe host, query ni firmas ni introduce un proxy arbitrario. La adaptación de URLs firmadas, orígenes CORS, cargas y límites de medios para esa entrada debe cerrarse mediante contratos del backend antes de configurarla en producción.

Los subtítulos se seleccionan desde la pista o un selector nativo. Un componente de frase compartido por timeline y panel consume la misma selección y formulario de EditorState; no crea un segundo borrador ni llama HTTP directamente. Los modelos puros caption-cues y caption-timeline validan texto simple y tiempos absolutos, calculan geometría relativa al clip y separan superposiciones sin reordenar el payload. La transcripción vinculada es de solo lectura: una acción explícita crea una copia local de las frases que cruzan el intervalo, ajustando sus extremos a los límites del clip. Guardar convierte esa copia en subtítulos aportados por el usuario mediante la misma revisión/ETag; no se modifica el análisis original.

La selección no forma parte del snapshot de cambios. La edición, conversión, alta y retirada de frases comprueban el rol y el estado de guardado; lector conserva selección y consulta. Guardado mantiene la selección válida; recarga, restauración y cambio de edición la reinician. La restauración consulta de nuevo la transcripción de esa revisión, con una generación de petición independiente y errores recuperables sin descartar el formulario. Los componentes de timeline y frase aíslan sus estilos, IDs y breakpoints; los IDs usan un contexto distinto para panel y timeline. La navegación de pista tiene foco móvil con flechas/Inicio/Fin y los ajustes usan campos numéricos y rangos nativos.

Pendientes de UX/componentización: selección visual de segunda fuente, más granularidad en seguridad/privacidad, thumbnails de video persistentes cuando exista su contrato, listado/reanudación multipart y experiencia administrativa cuando existan permisos globales y contratos estables. La edición local de cues en timeline ya está implementada; falta aceptación por UI contra la API activa para ese flujo nuevo. Estos límites no se presentan como funciones verificadas de extremo a extremo.

La revisión de arquitectura/accesibilidad de este bloque conserva la prueba de límites core/shared, DTO generados y un único estado de edición. Se revisaron etiquetas explícitas, IDs separados para controles duplicados, errores asociados, foco visible, retirada de la selección, movimiento reducido y estado vacío responsive. No es una auditoría completa de accesibilidad. La responsividad coordinada del shell/editor todavía tiene reglas en styles.css: su extracción gradual hacia los layouts/features debe conservar el orden de capas y los tamaños revisados.

La reproducción utiliza sesiones locales con token creciente y un elemento video nuevo por enlace autorizado. EditorState valida que la exportación terminada contenga video y pertenezca a la lista consultada; almacena su ID de revisión, sin deducir identidad por el número visible. El modelo puro caption-playback comprueba el intervalo del renderSpec inmutable contra la duración medida del video (tolerancia de 0,25 s) y convierte cues absolutos a offsets del clip. Solo enlaza las frases que coinciden con el texto y extremos de los cues resueltos del render. Un borrador modificado, una revisión distinta/no informada o medios inválidos desactivan búsqueda y resaltado; el aviso permanece visible.

La selección para editar y el tiempo de reproducción son estados separados. El reproductor consume una solicitud explícita de búsqueda una sola vez, conserva los controles nativos y no inicia autoplay. Los eventos llevan el token del elemento que los originó; cambiar edición o renovar enlace invalida los anteriores. Los errores no exponen la URL firmada y ofrecen solicitar un nuevo enlace autorizado. No se persisten enlaces ni tiempos de reproducción. La API/Docker apagada impide aún aceptar este flujo con medios reales por UI; la aceptación de roles QA también sigue pendiente y no requiere repetir las confirmaciones ya registradas.

El ciclo de acentos es estado local de la landing; nunca modifica `:root`. El controlador recibe un scheduler y libera su único temporizador en pausa, movimiento reducido y destrucción. El snapshot de contrato público dentro del frontend permite generar/verificar tipos sin depender de cambios centrales todavía sin commit. `contracts:sync` es la actualización explícita; `contracts:check` detecta divergencias.

La protección de cambios se limita a la feature editor: guard de salida, confirmación inyectable y beforeunload. No introduce un store global de formularios. Proyectos invalida generaciones de peticiones al cambiar referencias; una respuesta obsoleta no habilita acciones para el nuevo ID. La asociación pipeline/carga solo se conserva cuando se conoce por una intención creada aquí, usando IDs no secretos en el espacio local del usuario/proyecto. El contrato de consulta de pipeline no expone su upload de origen, por lo que no se inventa una asociación.

Guardar y exportar es una acción explícita del editor, compuesta por el PATCH con If-Match y un POST de render para la versión devuelta, sin crear ni encadenar pipelines. Conserva la revisión si el segundo paso falla y vuelve a comprobar el rol antes de solicitarlo. El intento de render guarda en memoria una clave ligada a ID/versión inmutable; una respuesta incierta conserva la clave, otra revisión obtiene otra. El recibo 201 se tipa desde el contrato y se mantiene separado del estado real consultado: no se construye una exportación ficticia ni se infiere que esté procesando. Una petición ya conocida pendiente abre Exportaciones; si no aparece aún en la lista, la consulta automática se acota a cinco intentos y un fallo detiene el polling. Las consultas de exportaciones tienen su propia generación para descartar resultados viejos dentro de la misma edición.

Los cues aportados se validan por conjunto: orden temporal, ausencia de superposición y duración mínima de 0,01 s, además del texto simple y límites anteriores. La geometría puede mostrar superposiciones locales para repararlas; no significa que se admitan al persistir. El formato original elimina framing al construir el payload y deshabilita sus controles de encuadre. Se comprueban tamaño entero 12–40, límites básicos de composición, marcas hasta 14400 s y el máximo real de 65000 bytes UTF-8 antes de escribir. El servidor conserva la validación definitiva de fuentes autorizadas y transcripción, sin confiar en el frontend.

Las descargas del editor verifican el artefacto dentro de la lista de exportaciones terminadas y usan etiquetas/nombres con revisión. EDITOR_ARTIFACT_DOWNLOAD inyecta la función nativa existente para poder observar efectos de descarga en tests; no agrega un transporte paralelo. Se descarta el grant de una edición anterior antes de invocarla. El estado de formulario, recibo, polling y mensajes continúa limitado a EditorState de la página; los componentes no hacen HTTP.

La entrada al editor desde un proyecto conserva localmente el EditorDraftDto real devuelto al crear el borrador, separado de la lista de revisiones consultada. La navegación se puede reintentar sin repetir el POST para el mismo cuerpo/carga; cambiar esos datos implica una intención distinta. Se valida el proyecto/upload del resultado y no se navega con una respuesta de un proyecto anterior. El resultado de otra carga del mismo proyecto queda identificado para apertura explícita. No se persiste este DTO en almacenamiento del navegador ni se fabrica una fila con fechas supuestas.

La lista de borradores tiene estados de carga/error/consulta completada y reintento independiente. La denegación 403/404 limpia datos anteriores e invalida consultas de fuentes; una caída de red conserva las filas conocidas con aviso. Las mutaciones del detalle comprueban rol y DESIGN_MODE dentro de sus métodos; el modo público de estructura no hace HTTP. ProjectsApi observa cancelación antes/después del hash y antes de confirmar. Una intención aceptada después del aborto se libera mediante el endpoint de cancelación existente antes de transferir bytes; un fallo se informa, sin ocultarlo como éxito. La selección de fuente y la asociación de transcripción siguen validándose con las reglas de procedencia anteriores; una referencia guardada en el navegador no prueba esa asociación.
