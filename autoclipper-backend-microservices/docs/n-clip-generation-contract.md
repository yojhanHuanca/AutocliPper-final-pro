# Contrato backend para generar varios clips

Revisado: 20 de octubre de 2026. Este documento separa capacidades actuales de la propuesta de integración. El estado activo de Docker observado esta fecha usa `compose.yaml` y `compose.business.yaml`; Whisper no está configurado. No se reiniciaron ni reconstruyeron servicios.

**Corte de implementación:** se añadió pipeline `version: 2` en código y contratos. Su cuerpo usa `subtitles.source=transcript|none`, y el selector recibe `contentType` explícito. El selector admite OpenAI (predeterminado) o Gemini explícito; Ollama devuelve `SELECTION_PROVIDER_NOT_SUPPORTED`. La aceptación automática permanece bloqueada hasta configurar transcripción y el proveedor seleccionado, y aprobar el presupuesto. Las pruebas con fixtures validan contratos y reglas, no reemplazan inferencia real.

## Estado actual

| Capacidad | Existe hoy | Límite / comportamiento real |
| --- | --- | --- |
| Pipeline desde un video | `POST /v1/uploads/{uploadId}/pipelines` | `version:1` conserva un intervalo manual con Whisper. `version:2` admite 1–3 propuestas automáticas, límite opcional por clip, tipo de contenido, aspect y subtítulos `transcript|none`. Ambas variantes requieren ASR; v2 además requiere selector. El preflight responde 503 tipado antes de encolar si falta cualquiera. Fuente local hasta 300 s; salida 0.1–120 s por clip. |
| Recorte sin ASR | `POST /v1/uploads/{uploadId}/processing` | Admite un clip manual y puede omitir `subtitles`. Devuelve MP4 sin transcript, SRT ni VTT. El usuario debe elegir el intervalo. |
| Transcripción + propuestas | `POST /v1/processing/{audioProcessingId}/analyses` | Whisper/Deepgram produce transcripción real. La selección automática requiere `selection.mode=llm` y el proveedor elegido por `AI_ANALYSIS_PROVIDER` (`openai` por defecto o `gemini` opcional). Cualquier otro valor, incluido `ollama`, devuelve `SELECTION_PROVIDER_NOT_SUPPORTED` antes de encolar. Solicita exactamente 1–3 propuestas con duración mínima/máxima de 1–120 s, `contentType` cerrado e instrucciones opcionales de hasta 2,000 caracteres. OpenAI y Gemini requieren clave privada, aprobación de uso pagado y límite por trabajo; Gemini además requiere modelo fijado y precios configurados para ese modelo. No hay fallback silencioso entre proveedores. |
| Render de propuesta(s) | Pipeline v2 crea hijos `POST /v1/analyses/{analysisId}/renders` internamente; consulta `GET /v1/pipelines/{id}` | Renderiza cada propuesta persistida en una tarea independiente. El campo `subtitles` elige transcript o ninguna; un render sin subtítulos no emite SRT/VTT. Descarga por clip en `GET /v1/pipelines/{id}/clips/{index}/download?kind=video|srt|vtt`. |
| Varios intervalos manuales | Editor/procesamiento individual | El endpoint de processing admite un render por solicitud. No hay una operación batch `N` ni un estado padre que agrupe varios renders. |
| Tamaño y formato | Renderer FFmpeg | Formato fijo MP4/H.264, audio AAC cuando hay pista, 30 fps, límite de archivo de video 64 MiB. No acepta resolución arbitraria ni tamaño objetivo configurable. SRT/VTT se generan cuando hay subtítulos. |

El editor admite `subtitles.source=none|user|transcript`, pero eso no convierte el pipeline actual en una generación de N clips. El render sin subtítulos es posible como tarea directa; el render por propuesta de análisis los crea obligatoriamente hoy.

## Contrato automático implementado

Conservar el pipeline v1 para compatibilidad. La variante versionada estricta para generación múltiple en `POST /v1/uploads/{uploadId}/pipelines` es:

```json
{
  "version": 2,
  "mode": "automatic",
  "provider": "whisper_cpp",
  "language": "auto",
  "clipCount": 3,
  "maxDurationSeconds": 30,
  "contentType": "tutorial",
  "aspect": "vertical",
  "subtitles": { "source": "transcript", "style": { "template": "clean", "fontSize": 24, "position": "bottom" } }
}
```

Reglas propuestas:

- `clipCount`: entero 1–3, en línea con el límite actual del selector y su salida validada. Aceptar valores mayores requiere ampliar explícitamente el modelo de salida, validadores y cuota.
- `maxDurationSeconds`: opcional; omitido significa 120 segundos. Si aparece, entero 1–120. El servicio exige que la duración seleccionada sea positiva y no exceda el máximo. No se promete que cada clip alcance exactamente ese máximo.
- `contentType`: enum cerrado, por ejemplo `general|tutorial|interview|gameplay|commentary|reaction`. El selector debe recibir el valor como una señal explícita de selección; no se guarda como metadato decorativo ni se interpreta como garantía de clasificación correcta. Si se necesita un tipo no enumerado, añadir un `instructions` opcional acotado y tratado como dato no confiable.
- `aspect`: reutiliza `source|vertical|square|horizontal`. Las dimensiones actuales son vertical 720×1280, cuadrado 720×720, horizontal 1280×720 y source ajustado dentro de 1280×720. La resolución no es configurable en este corte.
- `subtitles`: discriminador requerido `source=transcript|none`; `transcript` genera cues solo a partir del transcript real. `none` omite la pista y no genera SRT/VTT. Estilo solo aplica a `transcript`.
- No permitir `startSeconds`/`endSeconds` en `automatic`: los tiempos provienen de propuestas validadas sobre la fuente real. Separar el modo manual si se necesita, con `clips: [{startSeconds,endSeconds}]`, máximo 3, ordenados y no solapados; ese modo no requiere ASR, selección automática, ni `contentType`.

El pipeline durable implementa: inspección previa existente; WAV hijo; análisis persistido con ASR y selector real; validación de cantidad exacta, tiempos, duración, límites de transcript y no solapamiento; renders hijos indexados; reserva de almacenamiento por cada salida; conciliación de hijos y estado por clip. La admisión sigue condicionada a que el preflight confirme proveedores configurados.

Respuesta inicial `201`:

```json
{ "id": "uuid", "status": "queued", "requestedClips": 3, "completedClips": 0 }
```

`GET /v1/pipelines/{id}` debe devolver etapa/estado medidos, nunca porcentaje inventado, y una lista estable:

```json
{
  "id": "uuid", "status": "render", "stage": "render", "requestedClips": 3,
  "completedClips": 1,
  "clips": [
    { "index": 0, "status": "succeeded", "title": "...", "startSeconds": 12.4, "endSeconds": 38.1, "processingId": "uuid", "errorCode": null },
    { "index": 1, "status": "queued", "title": "...", "startSeconds": 55, "endSeconds": 81, "processingId": "uuid", "errorCode": null },
    { "index": 2, "status": "queued", "title": "...", "startSeconds": 103, "endSeconds": 129, "processingId": "uuid", "errorCode": null }
  ]
}
```

El endpoint implementado `GET /v1/pipelines/{id}/clips/{index}/download?kind=video|srt|vtt` aplica la autorización actual de workspace y solicita una URL temporal bajo demanda. Los estados terminales son `succeeded` si todos los renders terminan, `partial_failed` si hay éxito y fallo mezclados, `failed` si ninguno termina y `cancelled` si se cancela cooperativamente. Cada render fallido conserva su código; los reintentos quedan en el runtime de processing sin repetir ASR/selección ya concluidos.

La clave de idempotencia identifica la creación del pipeline completo. Los hijos se crean en transacciones Project con índice único por pipeline/etapa/clip, evitando duplicados al reconciliar. El máximo de tres renders reserva `N × 68,157,440` bytes más 134,217,728 bytes de WAV, bajo la cuota del workspace; la admisión limita a cuatro tareas activas del workspace. La cancelación detiene selector/render y limpia temporales/objetos parciales.

## Dependencias y límites de aceptación

`mode=automatic` necesita **dos proveedores reales configurados**: Whisper local (o Deepgram autorizado) para la transcripción, y el selector elegido para propuestas. OpenAI usa `OPENAI_API_KEY`, `OPENAI_MODEL`, precios configurados, `PAID_AI_ENABLED=true` y `AI_MAX_ESTIMATED_USD_PER_JOB` mayor o igual al coste máximo estimado (por defecto gpt-6-luna, prompt de hasta 5,000 bytes y 2,048 tokens de salida). Gemini requiere fijar `AI_ANALYSIS_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL`, precios vigentes de entrada/salida para ese modelo y los mismos gates de aprobación/presupuesto. Ninguno se prueba contra proveedor real hasta que se configure y apruebe gasto. El proveedor OpenAI permanece predeterminado; Gemini es opcional explícito. `AI_ANALYSIS_PROVIDER=ollama` y cualquier valor no admitido devuelven `SELECTION_PROVIDER_NOT_SUPPORTED` antes de encolar o contactar servicios de selección. La configuración local `compose.analysis-local.yaml` habilita whisper.cpp tiny, usa CPU/RAM locales, procesa fuentes de hasta 300 s y no aporta diarización. El preflight devuelve el código específico del proveedor o 503 `TRANSCRIPTION_NOT_CONFIGURED`; no encola trabajos mientras falte configuración.

El texto libre de selección usa la plantilla fija `segment-selection-v2`: se limita a 2,000 caracteres sin controles, se envía como preferencia no confiable y jamás se interpreta en modo local. Los proveedores reciben el mismo mensaje versionado, un esquema JSON con el conteo exacto, hasta 5,000 bytes de datos de entrada y hasta 2,048 tokens de salida; el preflight estima el costo máximo usando el sobre de solicitud y tarifas configuradas. `PAID_AI_ENABLED=false` bloquea antes del transporte, incluso si hay una clave configurada. Los tests usan respuestas de fixture; no certifican calidad del modelo ni una factura real.

`mode=manual` puede generar varios clips sin transcripción ni coste de proveedor: cada intervalo lo elige el usuario y `subtitles.source` debe ser `none` (o permitir cues `user` en un contrato separado). Este modo no puede afirmar selección automática por tipo de contenido.

No aceptar “content type”, “max duration”, cantidad, resolución ni subtitles en frontend hasta que cada campo se valide en DTO/schema y afecte a su etapa. Una prueba real debe verificar N propuestas exactas y distintas, render MP4 por clip, dimensiones/aspect, presencia/ausencia de SRT/VTT según opción, cuota N, idempotencia/reintento, cancelación y aislamiento de workspace. Probar primero con fixtures para el selector y el flujo opt-in local, sin reemplazar la aceptación real por un mock.

## Matriz vigente de importación de fuentes

- **YouTube:** permitir embed/preview conforme a política, pero no descargar ni copiar el audiovisual sin aprobación escrita previa de YouTube. [Políticas oficiales (español)](https://developers.google.com/youtube/terms/developer-policies?hl=es).
- **Kick:** su catálogo oficial de API no documenta una operación de clips ni descarga audiovisual; dejar importación automática como no disponible. El fallback es descargar manualmente contenido autorizado desde Kick y usar la carga existente. [Índice oficial Kick Dev](https://docs.kick.com/llms.txt), [ayuda oficial de clips](https://help.kick.com/en/articles/7120566-how-to-create-clips-on-kick).
- **Twitch:** candidata únicamente para clips autorizados; Helix devuelve URLs temporales, limita a 10 IDs por solicitud y 100 solicitudes/minuto, y exige scope `editor:manage:clips` o `channel:manage:clips`, usuario/editor coincidente y acceso del editor al broadcaster. La app OAuth y el worker de importación aún no están implementados/configurados. [Helix Get Clips Download](https://dev.twitch.tv/docs/api/reference/#get-clips-download), [OAuth Authorization Code](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/), [validación de token](https://dev.twitch.tv/docs/authentication/validate-tokens/).
