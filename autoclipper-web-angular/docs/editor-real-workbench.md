# Editor real de borradores

La ruta de cuenta `/app/edits/:id` abre un borrador guardado. Consulta el borrador, el proyecto, la lista de borradores, la duración inspeccionada de la fuente y los metadatos disponibles. `/design/editor` es una muestra sin lecturas ni escrituras de cuenta.

## Acciones conectadas al servidor

- **Ver video original** solicita `GET /uploads/:id/source-playback`. El servidor verifica la carga y entrega una URL firmada privada que vence en un máximo de 120 segundos. Renovar el enlace obtiene uno nuevo. La URL no forma parte de la revisión guardada.
- **Guardar revisión** envía `PATCH /edits/:id` con la versión actual y `If-Match`. Se persisten el inicio y fin del corte manual, aspecto, encuadre, composición de pantalla dividida si se habilita, y subtítulos/estilo. El editor confirma la revisión devuelta por el servidor; un conflicto de versión conserva la edición local para recuperarla.
- **Guardar y exportar** primero persiste la revisión. Solo después solicita `POST /edits/:id/renders` para esa versión, usando una clave de idempotencia. La solicitud aceptada no significa que el video ya esté listo: la pestaña Exportaciones consulta el estado real y ofrece reproducción o descarga solo de artefactos terminados.
- **Exportar revisión** sin cambios solicita el render de la versión actual. Si ya hay una solicitud de esa revisión en cola o en proceso, lleva a su estado y no crea una duplicada.
- **Historial y recuperación** consultan revisiones reales; recuperar una anterior crea una versión nueva mediante la ruta de restauración. Comentarios y decisiones de revisión usan los endpoints de colaboración existentes.
- **Subtítulos de transcripción** permanecen de solo lectura. “Crear copia editable” copia y recorta las frases que cruzan el intervalo actual; solo esa copia se puede cambiar y guardar en la revisión.

## Vista previa y límites

El reproductor del original muestra el encuadre y las frases en los tiempos de la fuente; representa los valores locales antes de guardar, pero no genera un MP4. El corte, la pantalla dividida y su mezcla se validan en el render del servidor. Un render existente siempre se identifica con su revisión; sus frases solo se sincronizan cuando el servidor informa la misma revisión y su intervalo coincide con la duración medida del video.

El corte debe medir entre 0,1 y 120 segundos y quedar dentro de la fuente inspeccionada. El formato puede ser vertical 9:16, cuadrado, horizontal 16:9 u original; el encuadre manual usa coordenadas normalizadas. La pantalla dividida acepta una segunda carga autorizada del mismo espacio e incluye distribución, proporción, inicio, política para fuente corta y pista de audio seleccionada. El contrato aún no entrega un selector de fuentes, así que se pide el UUID de la carga inspeccionada.

Subtítulos manuales admiten hasta 200 frases de texto simple, con intervalos cronológicos no superpuestos y acotados al clip. El tamaño de estilo es de 12 a 40 y la revisión serializada está limitada a 65 000 bytes. Los controles Dividir, Duplicar y Eliminar permanecen desactivados porque no existen esas operaciones para borradores en la API. Audio/color para una fuente única, filtros, seguimiento de caras, selección automática de momentos, capas de texto libres y publicación a YouTube/Kick/Twitch tampoco están disponibles; no se simulan.

## Comprobación de esta implementación

La suite Angular completa pasó con 336 pruebas; `npm run typecheck` y `npm run build` terminaron correctamente. No se ejecutaron escrituras autenticadas contra el gateway ni se reinició Docker. Para la verificación de interacción con medios reales se necesita la ventana coordinada de despliegue y un usuario/editor de QA con una carga confirmada.
