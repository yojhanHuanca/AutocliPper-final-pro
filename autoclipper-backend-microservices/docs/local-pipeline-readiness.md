# Diagnóstico y activación del pipeline local

## Estado comprobado el 28 de octubre de 2026

El gateway local responde en `http://localhost:3005`; Analysis usa Whisper local para transcripción. Gemini está disponible como selector LLM opcional explícito; Ollama no está admitido. El modelo Whisper `../.local/models/ggml-tiny.bin` está verificado y el renderer usa FFmpeg/FFprobe 5.1.9. En esa versión, la selección automática dependía de un LLM pagado.

## Revalidación del runtime local (1 de noviembre de 2026)

Gateway devolvió HTTP 200 en `/v1/health/live` y `/v1/health/ready`; Docker informa saludables Identity, Project, Analysis, Media y Renderer. `GET /v1/auth/providers` devolvió HTTP 200 con `twitch.configured=true`. `GET /v1/auth/twitch/link` sin sesión devolvió 401, así que esta consulta no confirma si hay una cuenta enlazada. No se hizo OAuth, descarga CDN ni importación Twitch real.

La inspección segura del entorno del proceso Analysis devolvió `AI_ANALYSIS_PROVIDER=openai`, clave ausente en el contenedor, `PAID_AI_ENABLED=false` y `AI_MAX_ESTIMATED_USD_PER_JOB=0`. No se reinició Analysis y no se hicieron solicitudes pagadas. El gate bloqueó la selección LLM como estaba previsto.

## Prueba local de edición y despliegue preparado (1 de noviembre de 2026)

Tras autorización del usuario se actualizaron Gateway, Project y Web; los tres contenedores responden saludables. En un proyecto local de QA se cargó un MP4 sintético; Media confirmó 8 s y 720×1280. Se completó un render manual, el editor abrió el resultado y Dividir guardó dos borradores de 4 s conservando el original. No se ejecutó selección automática ni se llamó a IA.

Analysis sigue en la imagen anterior. Se preparó una imagen nueva con selector local determinista (`sha256:f1001d3d0282169da50726cf383ea16bce04f49c13320730cea8cfb90a9fb6b7`), pero no se recreó Analysis. Por ello el modo local ya pasa contrato y pruebas en el árbol de trabajo, pero la selección automática local aún no está comprobada de punta a punta en runtime.

La aceptación sintética manual (inspección, render y descarga con SHA-256) pasó. Una prueba anterior recorrió selección automática con Ollama; esa ruta quedó deshabilitada y su resultado no acredita el comportamiento actual. Desde la actualización de código del 1 de noviembre, las solicitudes automáticas v2 usan por defecto una heurística local determinista: N ventanas equidistantes, limitadas por duración y con títulos tomados de la transcripción. No usa LLM ni promete detectar momentos virales. `selectionMode=llm` es una opción explícita y conserva los gates de clave y gasto.

Las pruebas de LLM usan transportes simulados; no prueban credenciales ni generación contra OpenAI o Gemini. La elección de proveedor LLM sigue siendo OpenAI por defecto, pero el Pipeline v2 selecciona localmente si omite `selectionMode`. Un pedido `selectionMode=llm` sin `OPENAI_API_KEY`, pago explícito y presupuesto positivo conserva HTTP 503 y no llama a proveedores. Gemini requiere además modelo y precios configurados. No se deben compartir claves por chat, navegador ni repositorio.

El código ahora acepta únicamente los modelos aprobados `gpt-6-luna` para OpenAI y `gemini-2.5-flash` para Gemini; cualquier otro identificador produce `SELECTION_MODEL_NOT_SUPPORTED` antes del transporte. Incorporar otro modelo requiere aprobar su identificador exacto y precios. Un proveedor inválido produce `SELECTION_PROVIDER_NOT_SUPPORTED`, incluso para trabajos que ya estaban en cola; no cae en OpenAI por defecto. Ollama está permanentemente marcado como no soportado, no se inspecciona su URL y el helper local de selección falla sin generar override. Estas garantías se prueban con transportes falsos, nunca con credenciales o endpoints de proveedores.

Se corrigió un bloqueo real del pipeline automático: la restricción de `remaining_reservation_bytes` no admitía el saldo tras reservar el audio de pipelines de dos o tres clips. La migración `0013_pipeline_audio_reservation_intermediate_states.sql` añade esos estados permitidos y ya se aplicó en la base local de Project.

## Consultar el preflight

Con una sesión iniciada, `GET http://localhost:3005/v1/analyses/providers` informa capacidades del proceso activo. Antes de activar las imágenes nuevas, el contenedor puede seguir mostrando `automaticPipeline.ready: false`; en el código actualizado, esa bandera corresponde a Whisper local y `selectionMode` es `local`. El diagnóstico LLM puede seguir diciendo que falta una clave: no bloquea el modo local. La respuesta no incluye valores secretos.

`selection.readiness` describe el proveedor LLM configurado: `disabled` indica que el gate de gasto está cerrado; `missing_credentials` indica clave ausente; `ready` que modelo, precios, credencial y gates pasan comprobaciones locales; `unsupported` un proveedor no admitido. Esa señal no determina la disponibilidad del selector local. Consultar capacidades no contacta OpenAI ni Gemini. `/health/ready` sigue describiendo la infraestructura.

El preflight de `POST /v1/uploads/{uploadId}/pipelines` requiere Whisper local y valida que N clips de duración mínima quepan en la fuente. La selección local no requiere proveedor generativo. Si se pide explícitamente `selectionMode=llm`, el preflight conserva HTTP 503 cuando faltan credenciales, pago o presupuesto. Una carga manual de intervalo usa `POST /v1/uploads/{uploadId}/processing` y puede renderizar sin transcripción/selección si la admisión del servidor lo permite.

## Perfil local mínimo

`compose.analysis-local.yaml` mantiene la transcripción local: compila whisper.cpp 1.9.5 desde código fijado por SHA-256, monta el modelo tiny verificado en solo lectura y limita Analysis a 768 MiB y 2 CPU. La selección determinista está en Analysis y no necesita un contenedor Ollama. Gemini/OpenAI solo se usan si la solicitud elige LLM y pasan sus gates; no hay fallback entre proveedores.

El antiguo `scripts/prepare-analysis-selection.mjs` se conserva como guardia de compatibilidad y ahora rechaza la operación antes de hacer solicitudes o generar archivos.

Las migraciones locales de Project `0011_multi_clip_pipelines.sql`, `0012_twitch_source_imports.sql` y `0013_pipeline_audio_reservation_intermediate_states.sql` están aplicadas con el migrador Drizzle. También se aplicaron las migraciones Identity `0011`–`0013`; se verificó `twitch_links` y el permiso de broadcaster/editor. Las migraciones solo se aplicaron a las bases locales.

Gateway, Project y Web ya usan las imágenes nuevas. Analysis conserva la imagen anterior y no reconoce todavía `selection.mode=local`; por eso el selector local está compilado y probado, pero no activo en el runtime automático. La imagen nueva `autoclipper-analysis-local:0.3.0` está preparada. Para usar LLM en el futuro, hace falta una clave privada, autorización explícita de pago, presupuesto positivo y `selectionMode=llm`; no guardes la clave en el navegador ni en el repositorio.

Las pruebas locales verifican el selector determinista, límites, conteo, no solapamiento, coste externo cero y preflight con LLM desactivado. Las pruebas de OpenAI y Gemini usan transportes de fixture y no llaman a sus APIs. La interfaz ya usa Gateway, Project y Web actualizados; para que la solicitud automática local funcione falta actualizar Analysis en una ventana autorizada.

## Revisión de código backend (2 de noviembre de 2026)

`npm run build` pasó. Las pruebas locales sin servicios para Analysis/pipeline fixtures, importación Twitch/VOD, retención fallida, unlink OAuth y contratos de selección pasaron 69/69. Incluyen el paso de instrucciones al prompt versionado con transporte falso y verifican que una clave fixture no produce llamadas si el gasto está desactivado. La selección automática local sigue siendo determinista; las instrucciones de texto solo se aplican con `selectionMode=llm`.

Project ahora conserva el ID del clip VOD generado para que un retry reutilice ese clip, y bloquea reintentos cuando el resultado del POST es incierto. La migración 0015 está en el árbol de trabajo, pero en esta revisión no se aplicó a la base ni se desplegó. No hubo una prueba Twitch real ni llamada a proveedor pagado.

Al comprobar el entorno, Docker no tenía disponible el engine Linux. No se reinició ni recreó ningún servicio, y el flujo activo de runtime (inspección, análisis, FFmpeg, editor y descarga) no se revalidó en esta sesión. El último estado de contenedores registrado arriba es histórico; revisar de nuevo cuando Docker esté disponible.

## Aceptación local determinista y migraciones (2 de noviembre de 2026)

`tests/local-ai/pipeline.test.mjs` ahora usa su intención durable para recorrer el pipeline automático v2 con `selectionMode=local`: carga el MP4 sintético autenticado, extrae/transcribe audio con Whisper.cpp, verifica el selector determinista y coste cero, espera el render subtitulado y descarga MP4/SRT/VTT comprobando SHA-256. También comprueba que el job no creó filas en `provider_attempts` y que `paidExecutionEnabled` está desactivado. El procedimiento Docker-only está en el [README raíz](../../README.md#optional-local-pipeline-acceptance-docker-only).

La prueba requiere el stack Compose, acceso a PostgreSQL, FFmpeg y el modelo tiny verificado. Docker no estaba disponible al actualizar esta guía, así que solo se puede validar el código y sus pruebas sin servicios; no se declara una aceptación E2E real en esta revisión.

La migración Identity `0014_admin_grants_read_permission` y Project `0015_twitch_vod_clip_import_state` están registradas junto con sus archivos SQL. El [README raíz](../../README.md#optional-local-pipeline-acceptance-docker-only) incluye cómo ejecutar los one-shot `migrate-identity` y `migrate-project`; cada runner también aplica migraciones anteriores aún pendientes. No se verificó el estado actual de esas migraciones en ninguna base de datos, y no se reinició ni recreó ningún servicio.

## Aceptación real y estado de imágenes (2 de noviembre de 2026)

Se ejecutó `tests/local-ai/pipeline.test.mjs` contra el Gateway local en `http://127.0.0.1:3005`, con dos cuentas de aceptación y un MP4 sintético. Pasaron la carga e inspección, el render con transcripción, las revisiones del editor, la selección automática determinista local de un clip, las descargas MP4/SRT/VTT verificadas por SHA-256, el control entre usuarios y el borrado lógico del proyecto de QA. El job de Whisper.cpp terminó con proveedor `whisper_cpp` y coste externo cero; el pipeline no creó intentos de proveedor pagado. No se llamó a OpenAI ni a Gemini.

El runner informó 5 subpruebas aprobadas y 2 fallidas, contando el fallo de la prueba contenedora. La única aserción funcional fallida fue el preflight intencional `selection.mode=llm` cuando no hay pago/presupuesto habilitado: Analysis devolvió `SELECTION_MODEL_NOT_SUPPORTED`, pero el Project activo respondió `DEPENDENCY_UNAVAILABLE`. Una consulta directa confirmó que Analysis informa el código seguro esperado. El filtro del código fuente de Project ya conserva `SELECTION_MODEL_NOT_SUPPORTED`; la prueba HTTP local `node --test tests/http.test.mjs` pasó 6/6.

Se reconstruyó la imagen compartida `autoclipper-backend:0.2.0` (ID `sha256:db8e62d05e6a180ea26009a58228b089f158b560c58349b67eb60bf587c23d92`). Una ejecución desechable con red desactivada sobre esa imagen confirmó HTTP 503, `SELECTION_MODEL_NOT_SUPPORTED` y `nextAction=review_ai_provider`. El contenedor Project sigue saludable, pero usa el ID anterior `sha256:4d44ccb000fb8234a26487a882c1e2a8f411b8e848b27fd18b03ae70263f4c7f`. No se recreó ni reinició ningún servicio. Para activar la corrección del contrato basta recrear `project` en una ventana autorizada; no requiere migración. Hasta entonces, el flujo local automático y la edición ya son demostrables, pero el preflight LLM muestra el código genérico en runtime.

Esta aceptación valida el recorrido con archivo local sintético, no OAuth ni importación real de Twitch. Para Twitch aún se necesita enlazar una cuenta autorizada y probar el intervalo VOD en una sesión real. Kick continúa con descarga oficial manual y YouTube con metadatos salvo aprobación escrita para importar audiovisual.

La aceptación complementaria del frontend contra Gateway `3005` terminó 7/7. Usó una cuenta y un workspace sintéticos aislados y recorrió carga/checksum/inspección, Whisper, pipeline, edición/versionado, render, descargas, consumo y denegación a otra cuenta. El resumen queda en `autoclipper-web-angular/.local/acceptance/result.json` (ignorado por Git; no se copia aquí ningún correo, ID ni dato de acceso). No se repitió la aceptación para evitar duplicar recursos de QA. Gateway, Project, Analysis y Web permanecen saludables; Project sigue usando la imagen anterior indicada arriba.

## Revalidación después de actualizar Project (2 de noviembre de 2026)

Con autorización del coordinador se recreó solo `project`; Gateway, Analysis y Web no se recrearon. Project está saludable con `sha256:db8e62d05e6a180ea26009a58228b089f158b560c58349b67eb60bf587c23d92`, la imagen reconstruida. Se repitió la aceptación desde el host para que las URLs firmadas de Storage resolvieran en `127.0.0.1:19000`; `tests/local-ai/pipeline.test.mjs` pasó 7/7. Incluye el preflight explícito sin gasto, que ahora conserva HTTP 503 `SELECTION_MODEL_NOT_SUPPORTED`, y el pipeline local completo con Whisper.cpp, selección determinista, render, descargas MP4/SRT/VTT con SHA-256, consumo y permisos. La base de análisis no registró intentos pagados. No se llamó a OpenAI ni a Gemini.
