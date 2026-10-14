# Edición versionada y exportación por revisión

Entrega independiente de etapa 4, 14 de octubre de 2026. Backend para guardar un recorte, recuperar revisiones y exportar una revisión concreta con encuadre manual y plantillas de subtítulos. La interfaz Angular, seguimiento automático, marca, mezcla de audio, comentarios y aprobaciones siguen pendientes. La selección del intervalo continúa siendo manual cuando el análisis usa `selection.mode=none`.

## Comportamiento y persistencia

Project es dueño de `editor_drafts` y `editor_revisions`, migración `0005_editor_revisions`. Una transacción crea o avanza el borrador junto con su revisión. La FK diferida exige que la versión actual exista al confirmar; un trigger impide modificar o eliminar una revisión mientras existe su borrador. Restaurar conserva el historial y crea otra revisión con `action=restored` y `restoredFromVersion`.

Cada revisión conserva dos descripciones: `spec` es la intención validada del usuario; `renderSpec` es la instantánea resuelta por el servidor. Si se solicitan subtítulos de una transcripción, el servidor comprueba permiso, éxito y pertenencia al mismo upload y conserva cues/transcriptId reales. El cliente no puede aportar cues bajo procedencia transcript. Restaurar/exportar una revisión utiliza su instantánea guardada.

El guardado exige `version` actual en el cuerpo. `UPDATE ... WHERE current_version = version` permite que solo un escritor concurrente avance; los demás reciben HTTP 412 `VERSION_CONFLICT`. GET devuelve `ETag: "N"`. Si PATCH o restore incluyen `If-Match`, también debe coincidir con la versión del cuerpo. No existe sobrescritura forzada.

La exportación añade `editor_revision_id` a la intención de procesamiento dentro de la misma transacción que reserva cuota. La idempotencia incluye la revisión elegida, incluso cuando dos revisiones tienen contenido idéntico. Los renders anteriores ajenos al editor conservan su hash de idempotencia. Media recibe únicamente la descripción interna validada, sin acceso a la base Project ni FK entre servicios. Se reutilizan outbox, reintentos, cancelación, límites de recursos y descarga privada del renderer existente.

## API pública

Todas las rutas tienen prefijo `/v1`. Lecturas requieren reader y mutaciones editor, con membresía vigente y recurso activo. Mutaciones también verifican Origin/CSRF; creación y render requieren `Idempotency-Key` UUID. Otro usuario no obtiene revisiones, exportaciones ni nuevas URLs; la papelera bloquea el acceso nuevo. Una URL ya emitida conserva su caducidad de 120 segundos.

| Método y ruta | Comportamiento |
|---|---|
| POST `/uploads/{id}/edits` | Crea borrador y revisión 1; cuerpo `{name,spec}` |
| GET `/edits/{id}` | Borrador actual, revisión completa y ETag |
| PATCH `/edits/{id}` | Guarda `{version,spec}` mediante CAS |
| GET `/edits/{id}/revisions` | Metadatos del historial descendente, máximo 50; cursor `beforeVersion` exclusivo |
| GET `/edits/{id}/revisions/{version}` | Instantánea inmutable específica |
| POST `/edits/{id}/restore` | `{version,revisionVersion}`; crea una nueva versión |
| POST `/edits/{id}/renders` | `{revisionVersion}`; exporta esa revisión aunque el borrador haya avanzado |
| GET `/edits/{id}/exports` | Últimas 50 intenciones con `editorRevisionId`, estado y metadatos seguros |
| GET `/projects/{id}/edits` | Últimos 50 borradores; comprueba permiso incluso cuando está vacío |

Los listados de historial y exportaciones omiten las descripciones potencialmente grandes para respetar el límite JSON del gateway. La revisión específica devuelve ambas instantáneas completas; `/processing/{id}` devuelve la spec y estado completos de una exportación.

Creación, con headers de sesión/CSRF/idempotencia:

```json
{
  "name": "Recorte con revisión",
  "spec": {
    "version": 1,
    "kind": "clip",
    "startSeconds": 0,
    "endSeconds": 8,
    "aspect": "square",
    "framing": {"x": 1, "y": 0.5},
    "subtitles": {
      "source": "user",
      "cues": [{"startSeconds": 0, "endSeconds": 7, "text": "Texto aportado explícitamente"}],
      "style": {"template": "bold", "fontSize": 30, "position": "top"}
    }
  }
}
```

Alternativas de subtítulos: `{ "source": "none" }` (default), `user` con cues o `transcript` con `analysisId` autorizado y style opcional. Los tiempos de cues son absolutos respecto a la fuente. La instantánea para render desplaza/recorta los cues al intervalo al producir SRT/VTT, según el comportamiento multimedia existente.

## Encuadre y estilos

`framing.x/y` son fracciones finitas entre 0 y 1 del excedente después de escalar la fuente para cubrir la salida. Cero selecciona izquierda/arriba, 0.5 centra y uno derecha/abajo. No son coordenadas de detección de caras. Un eje sin excedente no cambia el resultado. Solo se permite framing con `vertical`, `square` u `horizontal`; `source` conserva el aspecto y rechaza framing.

Plantillas cerradas: `clean` (blanco y contorno negro), `boxed` (blanco y caja negra semitransparente) y `bold` (amarillo, negrita y contorno negro). Fuente fija DejaVu Sans; tamaño lógico ASS 12–40, posición top/bottom y margen 32. El cliente no puede inyectar nombres de filtros, rutas, ASS ni argumentos. El tamaño lógico se escala según libass y no promete píxeles CSS. El estilo se quema en MP4; SRT/VTT continúan siendo texto y tiempos, sin reproducir el estilo visual.

Las pruebas sobre frames detectaron y corrigieron dos errores: `force_style` usa bits internos libass para alineación (top-center = 4 | 2 = 6), y la caja BorderStyle=3 utiliza OutlineColour con alfa 0x80. Se verificaron regiones de color, glifos amarillos en la mitad superior y píxeles del fondo semitransparente. Referencia primaria: [asignación force_style](https://github.com/libass/libass/blob/master/libass/ass.c) y [constantes de alineación](https://github.com/libass/libass/blob/master/libass/ass_types.h).

La primera aceptación de negocio detectó que el gateway perdía el ETag de versión y Express emitía otro débil para el cuerpo. Se corrigió el reenvío del ETag del servicio; el header ya está expuesto por CORS y If-Match se transmite al servicio. La comprobación end-to-end exige exactamente la versión entre comillas, además de probar el CAS concurrente.

Límites: recorte 0.1–120 segundos, duración dentro de la fuente inspeccionada, descripción JSON máxima 65,000 bytes; hasta 200 cues de usuario, ordenados, con validación estricta de texto/tiempos. Las peticiones clip v1 anteriores siguen siendo válidas sin framing/style. No se aceptan propiedades desconocidas ni se simula seguimiento automático.

## Verificación de esta entrega

Resultados locales ejecutados: todos aprobados, sin omisiones. Los conteos del runner incluyen tests padre. Las pruebas con proveedores de fixtures se identifican separadamente de la inferencia local real. CI se registra después de publicar y comprobar el SHA correspondiente.

| Verificación | Resultado |
|---|---|
| `npm run verify` y lint final del generador | Build TypeScript estricto, lint y 25 tests unitarios/HTTP aprobados |
| Node 24.21.0 explícito, `node --test tests/*.test.mjs` | 25 aprobados; Docker/CI también utilizan Node 24.21.0 |
| FFmpeg nativo 8.1.1, `tests/integration/editor-renderer.test.mjs` | 4 tests aprobados; regiones del crop, posición/color de glifos y caja semitransparente |
| `verification` Docker, PostgreSQL/Redis/S3 y FFmpeg 5.1.9 reales | 23 tests aprobados; 106.28 segundos del runner |
| `analysis-verification`, proveedor explícito de fixtures | 7 aprobados; 28.03 segundos; no acredita inferencia real |
| `business-verification` Docker | 41 aprobados tras corregir ETag; 75.41 segundos |
| `LOCAL_AI_ACCEPTANCE=true`, whisper.cpp/tiny reales | 6 aprobados; 48.78 segundos; transcripción real, edición y exportación de revisión anterior |
| `npm run openapi:export` / `npm run client:types` | Seis contratos con referencias locales válidas; tipos y headers del editor generados |
| `npm audit --audit-level=moderate` | Cero vulnerabilidades reportadas |

La aceptación nueva comprueba: creación idempotente/CSRF; dos escrituras concurrentes con solo una admitida; versiones e If-Match obsoletos rechazados; historial por cursor y ETag correcto; restauración que crea versión nueva; UPDATE directo de una revisión rechazado por PostgreSQL; exportación de revisión 2 mientras el borrador está en versión 4, con crop azul y subtítulos amarillos superiores medidos en el MP4; hash de descarga y asociación de exportación; accesos de otro usuario denegados y papelera. Con ASR real también se guardó la procedencia de la transcripción, se exportó la revisión 1 mientras el borrador estaba en 2 y se rechazó el análisis de otro upload del mismo usuario.

La revisión del generador detectó referencias `ErrorResponse` sin definición en contratos de servicio: la composición pública modificaba los mismos objetos de operación. Se corrigió con copia profunda antes de añadir respuestas/CSRF/security del gateway y se añadió validación de referencias locales a todos los documentos generados. OpenAPI describe ETag/If-Match y respuestas seguras 404/412/413; los tipos Angular se regeneran desde el documento público.

Comandos desde `autoclipper-infrastructure`, con Docker operativo y modelo tiny ya verificado:

```powershell
docker compose -f compose.yaml -f compose.business.yaml --profile app stop project media renderer analysis
docker compose -f compose.yaml -f compose.business.yaml -f compose.business-tests.yaml -f compose.analysis-local.yaml --profile app build media business-verification analysis
docker compose --profile app --profile test run --rm verification
docker compose -f compose.yaml -f compose.business.yaml -f compose.business-tests.yaml --profile app run --rm analysis-verification
docker compose -f compose.yaml -f compose.business.yaml -f compose.business-tests.yaml --profile app run --rm business-verification
docker compose -f compose.yaml -f compose.business.yaml -f compose.business-tests.yaml -f compose.analysis-local.yaml --profile app run --rm -e LOCAL_AI_ACCEPTANCE=true business-verification node --test tests/local-ai/*.test.mjs
docker compose -f compose.yaml -f compose.business.yaml -f compose.analysis-local.yaml --profile app up -d --no-build
```

Las suites aisladas solo se ejecutan en desarrollo: se detienen workers propios para evitar consumo cruzado y se restaura el stack después. No se eliminan volúmenes ni contenedores de otros proyectos. Los fixtures de negocio dejan cuentas/proyectos sintéticos en papelera; temporales locales se limpian. La purga integral de revisiones/objetos y el fulfillment de privacidad siguen pendientes, igual que producción, selección LLM real, traducción y aceptación externa Google/Deepgram.
