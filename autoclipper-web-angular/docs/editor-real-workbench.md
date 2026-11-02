# Editor real de borradores

La ruta de cuenta `/app/edits/:id` abre un borrador guardado. Consulta el borrador, el proyecto, la lista de borradores, la duración inspeccionada de la fuente y los metadatos disponibles. `/design/editor` es una muestra sin lecturas ni escrituras de cuenta.

## Acciones conectadas al servidor

- **Ver video original** solicita `GET /uploads/:id/source-playback`. El servidor verifica la carga y entrega una URL firmada privada que vence en un máximo de 120 segundos. Renovar el enlace obtiene uno nuevo. La URL no forma parte de la revisión guardada.
- **Guardar revisión** envía `PATCH /edits/:id` con la versión actual y `If-Match`. Se persisten el inicio y fin del corte manual, aspecto, encuadre, composición de pantalla dividida si se habilita, y subtítulos/estilo. El editor confirma la revisión devuelta por el servidor; un conflicto de versión conserva la edición local para recuperarla.
- **Guardar y exportar** primero persiste la revisión. Solo después solicita `POST /edits/:id/renders` para esa versión, usando una clave de idempotencia. La solicitud aceptada no significa que el video ya esté listo: la pestaña Exportaciones consulta el estado real y ofrece reproducción o descarga solo de artefactos terminados.
- **Exportar revisión** sin cambios solicita el render de la versión actual. Si ya hay una solicitud de esa revisión en cola o en proceso, lleva a su estado y no crea una duplicada.
- **Dividir clip** usa `POST /edits/:id/split` con el punto de corte, `If-Match` de la revisión guardada y una clave de idempotencia. Requiere permisos de edición, una revisión limpia y un intervalo confirmado. Si la conexión deja incierto el resultado, el mismo punto de corte queda bloqueado y se reintenta con la misma clave. El servidor guarda dos nuevos borradores en el proyecto y conserva el original; no inicia un render. La lista de clips se actualiza desde las dos revisiones devueltas por el servidor.
- **Historial y recuperación** consultan revisiones reales; recuperar una anterior crea una versión nueva mediante la ruta de restauración. Comentarios y decisiones de revisión usan los endpoints de colaboración existentes.
- **Subtítulos de transcripción** permanecen de solo lectura. “Crear copia editable” copia y recorta las frases que cruzan el intervalo actual; solo esa copia se puede cambiar y guardar en la revisión.

## Vista previa y límites

El reproductor del original muestra el encuadre y las frases en los tiempos de la fuente; representa los valores locales antes de guardar, pero no genera un MP4. El corte, la pantalla dividida y su mezcla se validan en el render del servidor. Un render existente siempre se identifica con su revisión; sus frases solo se sincronizan cuando el servidor informa la misma revisión y su intervalo coincide con la duración medida del video.

El corte debe medir entre 0,1 y 120 segundos y quedar dentro de la fuente inspeccionada. El formato puede ser vertical 9:16, cuadrado, horizontal 16:9 u original; el encuadre manual usa coordenadas normalizadas. La pantalla dividida acepta una segunda carga autorizada del mismo espacio e incluye distribución, proporción, inicio, política para fuente corta y pista de audio seleccionada. El contrato aún no entrega un selector de fuentes, así que se pide el UUID de la carga inspeccionada.

Subtítulos manuales admiten hasta 200 frases de texto simple, con intervalos cronológicos no superpuestos y acotados al clip. El tamaño de estilo es de 12 a 40 y la revisión serializada está limitada a 65 000 bytes. Duplicar y Eliminar permanecen desactivados porque no existen esas operaciones para borradores en la API. Audio/color para una fuente única, filtros, seguimiento de caras, selección automática de momentos, capas de texto libres y publicación a YouTube/Kick/Twitch tampoco están disponibles; no se simulan. YouTube sirve únicamente para previsualizar y consultar metadata cuando el servidor está configurado; Kick no se importa. Los clips de Twitch solo se importan tras OAuth y confirmación positiva del servidor.

## Verificación y bloqueos de entorno

Las pruebas dirigidas del editor, el flujo MP4, la seguridad HTTP y el sidebar pasaron: 126/126 pruebas en `project-workflow`, handoff de borradores y pruebas del editor; el corte prueba confirmación, roles, `If-Match`, CSRF, idempotencia y actualización de lista sin render. Estas pruebas usan respuestas controladas y no sustituyen la aceptación con un archivo propio en el navegador y servicios activos.

La aceptación interactiva en `localhost:4200` queda pendiente de una ventana de prueba con sesión de QA y una carga MP4 inspeccionada. No se reinició Docker ni se enviaron escrituras a un entorno en vivo.

La compilación y el chequeo global de tipos están bloqueados por errores preexistentes en `src/app/features/administration/pages/admin-console.component.ts`: `clearData` no existe (líneas 79, 127, 139, 144, 153, 162, 199, 259 y 329) y `authorityChanged` declara `boolean` pero no devuelve un valor (línea 408). La suite total registra 332 aprobadas y 13 fallidas; las 13 fallas son de Administración y lanzan `TypeError: this.clearData is not a function`. No se modificó ese archivo porque está en edición por Devia.

La hoja lateral ya está condicionada por la ruta real: `.app-shell.editor-mode` la reduce a iconos dentro del editor y las rutas fuera del editor conservan el ancho y los rótulos normales. La prueba `settings-session-revoke-style.test.mjs` cubre ambos estados.
