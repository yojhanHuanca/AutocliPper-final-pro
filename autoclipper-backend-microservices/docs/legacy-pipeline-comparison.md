# Comparación del pipeline Spring legado y el backend actual

Esta comparación es solo funcional. El repositorio Spring se inspeccionó en modo lectura; no se copiaron archivos, credenciales, cookies ni configuración privada.

## Capacidades que resolvía el legado

- `VideoImportService` creaba videos desde archivo o URL, persistía el registro y encolaba el trabajo después del commit.
- `VideoProcessingService` avanzaba por etapas de fuente, metadatos, transcripción con Whisper, selección de momentos y render con FFmpeg; guardaba porcentaje, etapa, mensajes y estado terminal.
- `HighlightAnalysisService` permitía seleccionar OpenAI o Gemini. Ante ciertas respuestas vacías intentaba el otro proveedor; `VideoProcessingService` también generaba propuestas de relleno si el análisis devolvía una lista vacía. Ese fallback podía producir clips que parecían automáticos sin una selección real y no se replica.
- La ruta de enlace delegaba URL arbitraria a `yt-dlp` y contemplaba cookies del navegador. No se porta: abre SSRF, depende de sesiones personales y no comprueba por proveedor una ruta de descarga autorizada.

## Equivalente en la arquitectura nueva

- Project guarda el pipeline, sus eventos, reservas, idempotencia y cancelación; outbox/BullMQ recupera trabajo asíncrono.
- Media inspecciona el archivo con FFprobe, extrae audio y renderiza recortes reales con FFmpeg.
- Analysis mantiene transcripciones y selecciones validadas, fases/errores, cancelación y control de resultado incierto del proveedor.
- Las solicitudes automáticas v2 usan por defecto `selectionMode=local`: Analysis distribuye ventanas temporales equidistantes, toma títulos del texto transcrito y registra coste externo cero. Es una heurística explícita, no una valoración de interés o viralidad.
- `selectionMode=llm` conserva OpenAI por defecto o Gemini cuando se configura; ambos exigen clave, autorización de uso pagado y presupuesto suficiente. Ollama no se admite. No existe fallback silencioso entre proveedores.
- Los diagnósticos no revelan secretos; la transcripción Whisper local y la selección determinista no hacen llamadas pagadas. El render manual por intervalo sigue disponible como alternativa.

## Contrato anterior frente al flujo HTTP actual

- **Alta por enlace:** el contrato antiguo usa `POST /api/videos/link` y crea un video `PENDING`. El backend nuevo expone `POST /v1/projects/{id}/source-links/import`; solo importa clips Twitch con cuenta y permiso verificados. YouTube queda en metadata/preview y Kick queda deshabilitado. Un archivo propio entra por `POST /v1/projects/{id}/uploads`.
- **Estados y trabajo asíncrono:** ya no hay un recurso único `Video` que recorra exactamente `PENDING → PROCESSING → READY`. Para un archivo, Project persiste Upload y estado de inspección; el cliente espera `inspection.status=succeeded`. El Pipeline es otro recurso con estados/eventos `queued → audio → analysis → render → succeeded` (o error/cancelación), consultable por `GET /v1/pipelines/{id}`. La importación Twitch devuelve `uploadId` con inspección `queued`; no inicia el Pipeline.
- **Descarga de origen:** el legado enviaba enlaces a `yt-dlp` y podía depender de cookies o impersonation. El backend nuevo no ejecuta ese extractor genérico. Twitch usa Helix y una descarga restringida a su CDN; el enlace temporal no llega al navegador. Kick Help Center recomienda descargas manuales de VOD propios y bajar clips como MP4, pero Kick ToS prohíbe sistemas automatizados para acceder al servicio y medios no autorizados. No hay contrato oficial de API para transferencia server-side; hasta autorización escrita o endpoint oficial, URL Kick sigue `unsupported`.
- **Audio y transcripción local:** el Pipeline nuevo crea las fases de audio y análisis; Analysis puede usar `whisper.cpp` local. `selection.mode=none` conserva el intervalo elegido por una persona.
- **Selección automática de segmentos:** el contrato v2 ahora ejecuta una heurística local determinista sin modelo generativo cuando no se indica modalidad. Distribuye N intervalos en la duración, limita cada uno por `maxDurationSeconds` y usa texto superpuesto como título. El backend no afirma que sean momentos virales. La selección LLM solo se ejecuta con `selectionMode=llm`, credenciales y autorización de gasto; jamás se activa por fallback.
- **Render, descarga y miniaturas:** Media usa FFmpeg para renders MP4; Project emite enlaces de descarga breves por `/v1/processing/{id}/download?kind=video` o por el endpoint de Pipeline. Las pruebas de aceptación verifican bytes, SHA-256 y MP4 real con fixtures; no acreditan el runtime Docker actual. No encontré un artefacto/API de thumbnail generado en el contrato nuevo, por lo que esa salida del contrato anterior sigue sin equivalente verificado.
- **Editor/export:** el editor nuevo guarda borradores y revisiones inmutables vinculados al upload y renderSpec; un render produce una tarea/artefacto nuevo, no una ruta local `originalOutputPath`. El origen y derivados viven en storage privado. El backend no reescribe el clip original ni degrada generaciones previas.

## Diferencias de importación por URL

- YouTube: no se descargan bytes desde enlaces. Las políticas de API de YouTube prohíben descargar/importar/copiar contenido audiovisual sin aprobación escrita previa; el preview oficial no da una ruta de importación. [Políticas oficiales de YouTube](https://developers.google.com/youtube/terms/developer-policies).
- Kick: la documentación pública enumera API de canales, usuarios, livestreams y otras capacidades, pero no una API de descarga de medios. Su ayuda oficial recomienda herramientas de terceros para VOD propios y permite descargar clips visibles como MP4; no define una API para que AutoClipper automatice la transferencia. Kick ToS prohíbe sistemas automatizados y tecnologías de acceso no autorizadas; Kick Dev ToS prohíbe integrar usos que violen esos términos. Por esa ambigüedad, no se incorpora `yt-dlp`, scraping ni HLS sin autorización programática explícita. [API pública](https://docs.kick.com/llms.txt), [descarga de VOD](https://help.kick.com/en/articles/7832538-how-to-download-your-kick-vod), [descarga de clips](https://help.kick.com/en/articles/7120566-how-to-create-clips-on-kick), [Kick ToS](https://kick.com/terms-of-service), [Kick Dev ToS](https://dev.kick.com/terms-of-service).
- Twitch: se implementó importación de clips concretos por Helix, con OAuth, scopes de broadcaster/editor, validación del rol, URL temporal, descarga restringida y almacenamiento privado. El runtime actual informa `twitch.configured=true`; el endpoint de vínculo sin sesión responde 401, así que no se verificó cuenta enlazada, consentimiento ni rol. No cubre VOD completo ni directos. [Helix Get Clips Download](https://dev.twitch.tv/docs/api/reference/#get-clips-download), [scopes oficiales](https://dev.twitch.tv/docs/authentication/scopes/).

## Bloqueo local actual

Gateway, Project y Web ya usan las imágenes nuevas. Analysis conserva OpenAI como proveedor LLM, con clave ausente dentro del contenedor, `PAID_AI_ENABLED=false` y presupuesto cero. Se construyó una nueva imagen Analysis con selección local, sin recrear ese servicio. No hubo llamadas a OpenAI/Gemini.

Una prueba autorizada con MP4 sintético de 8 s confirmó carga, inspección, render FFmpeg, apertura del editor y división persistida en dos borradores; el original se conservó. No se probó selección automática local de punta a punta porque el contenedor Analysis sigue antiguo. Tampoco se hizo importación real de Twitch/Kick. Las pruebas de proveedores LLM usan fixtures y no son una evaluación de calidad del proveedor.
