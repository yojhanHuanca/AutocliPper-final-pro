# Enlace → selección con IA → clips → compartir

## Arranque local sin llamadas de pago

Desde la raíz del repositorio, después del bootstrap del README:

```powershell
.\Start-AutoClipper.ps1 -Build
```

El arranque incluye Whisper.cpp para audio y `local_ai` para selección generativa con Qwen3 mediante Ollama privado. `PAID_AI_ENABLED=false` y el presupuesto externo permanece en cero. No se usa el selector equidistante como reemplazo silencioso de la IA. El modelo local consume RAM y CPU; su selección requiere revisión humana y no garantiza viralidad.

El contrato conserva `selectionMode=local` para clientes anteriores, pero la interfaz de generación envía explícitamente `selectionMode=llm`. El proveedor `local_ai` resuelve esa selección sin API de pago. OpenAI/Gemini continúan disponibles únicamente con configuración y autorización de gasto independientes.

## Flujo

1. Resolver una URL canónica de YouTube o un clip Twitch compatible.
2. Confirmar la importación. YouTube usa yt-dlp sin configuración personal, cookies del navegador, shell ni playlists; aplica tiempo y tamaño máximos. Una URL reconocida no garantiza que YouTube permita descargarla.
3. Guardar bytes en storage privado, verificar checksum y esperar inspección.
4. Configurar cantidad, duración máxima, aspecto, subtítulos e instrucciones para la IA.
5. Extraer audio, transcribir con tiempos, seleccionar fragmentos mediante el modelo y validar los intervalos.
6. FFmpeg renderiza los intervalos seleccionados. Cada resultado puede revisarse, descargarse o abrirse en el editor.
7. Exportar la revisión editada o compartir el resultado ya renderizado.

Límites actuales: fuente de hasta 100 MiB, audio de hasta una hora, de uno a tres clips y hasta 120 segundos por clip. Los límites de CPU, contexto o la disponibilidad de la fuente pueden causar un error explícito. Un fallo del modelo no crea recortes arbitrarios para aparentar éxito.

## Compartir

Los endpoints `/v1/social/connections`, `/v1/social/{provider}/connect`, `/v1/social/{provider}/callback`, `/v1/processing/{id}/publications` y `/v1/social/publications/{id}` conectan cuentas y mantienen trabajos de envío idempotentes. Tokens y refresh tokens se cifran en el servidor; el navegador nunca los recibe. Cada envío requiere consentimiento explícito, un MP4 terminado y acceso de editor. La visibilidad predeterminada de YouTube es privada.

- **YouTube:** OAuth `youtube.upload`, creación de una sesión resumible y transferencia del MP4. El resultado devuelve el ID y enlace del video recibido por YouTube; su procesamiento posterior y visibilidad dependen de YouTube y de la aplicación registrada.
- **TikTok:** OAuth `video.upload` y transferencia del archivo a la bandeja del creador. El creador revisa y confirma la publicación dentro de TikTok. `inbox` no significa publicación pública automática.

Las credenciales se configuran en el `.env` privado de infraestructura: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`, `TIKTOK_CLIENT_ID`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`. Los redirect URI deben coincidir con los registrados y cumplir los requisitos del proveedor; TikTok puede requerir un dominio HTTPS registrado. No se inventan credenciales ni se sustituye OAuth por un enlace a la página de subida.

Un resultado externo incierto queda `unknown` y no repite automáticamente un POST, para evitar duplicados. Una prueba simulada de proveedor no acredita publicación real con una cuenta. La integración de OAuth debe verificarse con las aplicaciones registradas y el consentimiento de sus titulares.

## Verificación local realizada

El 3 de noviembre de 2026 pasaron 175 pruebas de backend y 376 de frontend, además del chequeo de tipos y la compilación de producción. La prueba de aceptación real importó un video público de YouTube, ejecutó Whisper y Qwen locales, generó el MP4 con FFmpeg y comprobó su checksum y duración antes de exportar una revisión editada. No realizó llamadas a IA de pago ni envíos a redes sociales.

La comprobación desde la interfaz confirmó la persistencia de la revisión 2 y la reproducción de su exportación vertical de siete segundos (720 × 1280). Se corrigió el contenedor del reproductor para mostrar el video completo. OAuth y la publicación externa siguen pendientes de credenciales de aplicaciones registradas y de una prueba con sus titulares.

## Referencias de implementación

- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [Ollama: salidas estructuradas](https://docs.ollama.com/capabilities/structured-outputs)
- [YouTube: subida resumible](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)
- [TikTok: envío a la bandeja](https://developers.tiktok.com/doc/content-posting-api-reference-upload-video)
- [OpenAI: GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
