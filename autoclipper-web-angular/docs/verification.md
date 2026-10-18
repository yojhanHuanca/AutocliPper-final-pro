# Evidencia de la primera entrega

## Teclado y accesibilidad de los recorridos críticos — 2026-10-18

Revisión de código de login/registro, shell, proyecto/carga, editor, cuenta y administración: se conservaron las etiquetas nativas, permisos, estados de carga/error y reglas existentes de movimiento reducido. Se corrigió el foco de navegación entre páginas (main; sin robar foco a filtros/query o anclas), el menú móvil como diálogo con fondo inert, Tab/Shift+Tab contenidos y Escape/cierre con retorno al botón. La capa de fondo es ahora un control real de cierre; el contenido recibe margen de scroll para no quedar bajo cabeceras fijas. El selector de archivo conserva entrada nativa y ayuda asociada.

Login muestra errores por campo también fuera del registro, con aria-invalid/describedby y alerta; los toggles de contraseña/confirmación tienen nombres distintos. Cuenta vincula el error de zona horaria y ayuda/formato de factor a sus entradas. Tablas de consumo/admin permiten foco en su región desplazable. Seleccionar una herramienta del editor lleva el foco al inspector, vinculado mediante aria-controls; los tiempos de composición describen su rango válido.

122 pruebas aprobadas (cuatro nuevas sobre transición de página, skip, límites de Tab visibles y contenedor vacío), typecheck y build de producción aprobados. Una pasada final de navegador confirmó main enfocado al navegar, menú móvil con aria-modal/inert, Shift+Tab desde Cerrar hasta el último enlace y Escape cerrando; login inválido anunció «Revisa el formato del correo» con aria-invalid=true; Exportaciones enfocó editor-inspector-panel y mantuvo ancho 375/375 en móvil. Capturas: C:/Users/USER/Documents/Codex/artifacts/autoclipper-keyboard-2026-10-18/mobile-shell.jpg, mobile-login-error.jpg y mobile-editor-panel.jpg. No se repitieron login, correo, procesamientos, cambios de cuenta ni privilegios administrativos.

No es una certificación ni auditoría completa con lectores de pantalla. Las consultas administrativas pobladas requieren operador MFA, y el recorrido de correo sigue pendiente de su servicio; no se alteró backend ni se concedieron permisos. Reduced motion se revisó en los estilos/scheduler y sus pruebas existentes, sin atribuir una emulación de preferencia del sistema al navegador. Se conserva como base la revisión responsive real de cuenta/equipo/consumo del bloque anterior.

## Configuración, equipo y consumo del creador — 2026-10-18

Auditoría con status.md, stage-6-consumption.md, OpenAPI público y sus dueños: la privacidad solo registra solicitudes (fulfillment pending), las invitaciones requieren correo/cuenta coincidente, y el GET de invitaciones sigue sin esquema de respuesta utilizable. No se inventó ese listado ni se atribuyó entrega externa al POST. Billing pagina hasta 50 movimientos por cursor entero; su SQL filtra workspace/id y no el periodo, a diferencia del resumen mensual UTC. La UI distingue ambos alcances y mantiene la unidad de material por etapa, sin precios, suscripciones ni pagos.

Cuenta: errores independientes de perfil/MFA/privacidad/sesiones, reintentos de estado/listado, MFA desconocido sin alta ni solicitud de privacidad habilitada, y estado vacío solo tras consulta confirmada. URI/códigos tardíos se descartan al ocultar o salir de Seguridad, con expiración absoluta del alta. Una escritura confirmada conserva su mensaje aunque falle el GET posterior; el usuario no recibe un falso fallo de activación/rotación/desactivación/solicitud. Guardado de perfil descarta resultados tras destruir la vista o cambiar de cuenta.

Equipo: métodos bloqueados en diseño/carga/sin acceso, rol nuevo validado contra capacidades del actor, limpieza de miembros/drafts/confirmaciones tras denegación y reinicio de confirmación al cambiar destinatario. La revisión visual encontró el botón Continuar habilitado sin destinatario por leer la función signal en vez de su valor: corregido y comprobado deshabilitado. No se envió ninguna invitación ni se cambió rol/propiedad.

Consumo: 401/403/404 de resumen o ledger limpian todos los datos anteriores y el cursor, incluidas denegaciones al paginar. Las caídas transitorias conservan datos identificados como anteriores. Respuestas tardías o cursores de otro workspace no se aplican; quitar la selección no llama a la API. El periodo se presenta en UTC y el historial ya no se llama «del periodo». Las pruebas de fallos, concurrencia y MFA usan fixtures de cliente explícitos; no simulan evidencia del servidor.

Revisión real solo de lectura con la sesión QA existente: perfil cargado, MFA desactivado, una sesión listada y privacidad vacía confirmada; equipo con propietario actual y sin destino de transferencia elegible; consumo 40 s consumidos, 0 reservados y 3560 disponibles de 3600 para octubre UTC, con nueve movimientos del pipeline ya aceptado el día 17. No se ejecutaron nuevos login, cargas, pipelines, exportaciones, cambios de 2FA, revocaciones ni solicitudes de privacidad. La aceptación de invitaciones/roles y operaciones 2FA/privacidad por UI sigue pendiente; ejecución integral de privacidad continúa fuera del contrato implementado. No se inició Mailpit ni se tocó backend/infra.

Capturas de escritorio/móvil de cada módulo en C:/Users/USER/Documents/Codex/artifacts/autoclipper-creator-settings-2026-10-18/: settings-security-desktop.jpg, settings-security-mobile.jpg, settings-privacy-mobile.jpg, team-desktop.jpg, team-mobile.jpg, consumption-desktop.jpg y consumption-mobile.jpg. Sin desbordamiento horizontal del documento en 1440×1000 y 390×844; la tabla de movimientos conserva scroll propio. Consola sin errores/advertencias. 118 pruebas aprobadas, incluidas pérdida de permisos, cursor de otro espacio, respuestas sensibles tardías, éxito de escritura con fallo de consulta y prohibición de promover administrador desde un actor administrador. Typecheck/build de producción y contrato público aprobados.

## Consola administrativa de consulta — 2026-10-18

Auditoría contra stage-7-administration-read-only.md, contratos gateway/Identity y snapshot público: contracts:check coincide con upstream. La consola existente /admin utiliza GET access, POST access con CSRF y las cuatro consultas de lectura publicadas; no agrega acciones administrativas ni presupone que un owner/admin de workspace sea operador. El filtro conserva la allowlist y la paginación de 25 filas/cursor exclusivo. Las tablas muestran estados en español, fechas de trabajos, unidades de consumo por etapa y periodo UTC; UUID completos y versión de plan quedan en detalles desplegables.

Se cerraron riesgos encontrados en el cliente: actualización de capacidades invalida y limpia páginas anteriores, una actualización con el mismo permiso recarga la sección, respuestas tardías no restauran acceso ni filas, y el reloj real se comprueba antes/después de lecturas además de limpiar visualmente la elevación caducada cada segundo. Un fallo de consulta se distingue de una lista vacía confirmada. 401/403 cierran la autoridad local sin reintentos de filas; 429/503 exigen reintento explícito. La reautenticación valida el formato TOTP/recovery del contrato y el interceptor no repite contraseña/factor ni consultas administrativas ante 401, conservando la autoridad ligada a la sesión.

106 pruebas unitarias/cliente aprobadas, incluyendo concurrencia de capacidad/página, elevación obsoleta, caducidad antes y después de HTTP, negativos 401/403/429/503 y transporte CSRF/cookie sin replay del factor. Los DTO de estos tests son fixtures explícitos y no acreditan una cuenta operadora real. Typecheck y build de producción aprobados. La revisión visual del estado real sin grant a 1440×1000 y 390×844 confirmó ausencia de desbordamiento horizontal y consola sin errores/advertencias. Capturas locales: C:/Users/USER/Documents/Codex/artifacts/autoclipper-admin-read-only-2026-10-18/desktop-denied.jpg y mobile-denied.jpg. El contenido autorizado se cubre mediante pruebas de cliente, no con datos insertados en el navegador.

Durante este módulo el gateway volvió a responder HTTP 200 en /v1/health/ready sin intervención de este chat en servicios. La sesión existente visitó /admin por navegador y recibió «Esta cuenta no tiene un permiso operativo activo». No se concedieron grants ni se configuró MFA para forzar aceptación. Las consultas pobladas, reautenticación TOTP/recovery, expiración y revocación por UI con un operador real quedan pendientes de una cuenta autorizada; no se inventan credenciales. Mailpit permanece apagado y no se ejecutaron flujos de correo. No se repitieron login, cargas, pipelines ni exportaciones del ensayo anterior, ni se modificó backend.

## Ensayo real por interfaz y cierre — 2026-10-18

El 17 de octubre, con los servicios ya disponibles, se completó una única aceptación desde el navegador usando la sesión «QA voz propietario» y un espacio QA existente: creación de proyecto, selección del MP4 sintético propio, carga firmada real, confirmación/inspección y un pipeline de 0–8 s en español. El pipeline alcanzó Completado y sus MP4/SRT se descargaron desde los botones de la UI. FFprobe comprobó H.264, 720×1280, AAC y duración exacta de 8 s.

Desde ese mismo recorrido se creó y abrió el borrador con transcripción vinculada. Se seleccionó una frase, se creó una copia editable explícita y se corrigió su texto. «Guardar y exportar» guardó la revisión 2 y solicitó una sola exportación de esa revisión. La lista pasó de Procesando a Lista, el video cargó metadatos reales (8 s, readyState 4, sin MediaError) y «Ir a esta frase» buscó 4,88 s: video pausado, frase 2 seleccionada/activa y formulario Al día. Los MP4/SRT/VTT descargados llevan revisión 2 en el nombre; los dos sidecars contienen el texto corregido y tres cues. El MP4 resultante mide 419658 bytes y conserva video/audio de 8 s; SRT 244 bytes y VTT 252 bytes. SHA-256 e IDs no secretos están en .local/acceptance/integrated-ui-2026-10-17.json, ignorado por Git. No se guardaron cookies ni URLs firmadas.

La cuenta sintética frontend-qa registrada anteriormente pudo iniciar sesión por API y consultar su propio proyecto (200). Con esa misma sesión separada, el proyecto, editor, pipeline y grant de descarga de «QA voz propietario» devolvieron 403. La sesión de verificación se cerró. Esto comprueba aislamiento entre dos cuentas autenticadas, sin cambiar la sesión del navegador. El ensayo reutilizó cuenta y espacio existentes: no acredita un registro nuevo por UI, aceptación de invitaciones ni el recorrido real de Editor/Lector. Tampoco se repitió procesamiento después de la interrupción por uso.

Se corrigieron los hallazgos frontend del ensayo: el aviso de carga confirmada remite al estado de inspección y ya no dice que sigue esperando cuando la inspección terminó; el selector distingue Personal/Equipo y el rol en los dos espacios QA con el mismo nombre; el resumen muestra «1 exportación». No se modificaron backend, servicios, políticas de admisión, precios o suscripciones.

El cierre del 18 de octubre conserva 100 pruebas aprobadas, typecheck y build de producción. La comprobación de disponibilidad actual volvió a dar ECONNREFUSED en localhost:3000/v1/health/ready; se inició únicamente el servidor frontend para revisar su estado vacío. Por ello la revisión visual final no se presenta como otra aceptación poblada y los bloqueos «API apagada» de los apartados anteriores describen checkpoints históricos, anteriores al ensayo real exitoso.

La revisión visual final de /design/editor a 1440×1000 y 390×844 confirmó el estado vacío, sin desbordamiento horizontal del documento ni errores/advertencias de consola. Capturas locales: C:/Users/USER/Documents/Codex/artifacts/autoclipper-e2e-closure-2026-10-18/desktop-empty.jpg y mobile-empty.jpg. Esta vista de estructura no requiere autenticación y no sustituye la aceptación real del 17 de octubre.

## Del proyecto al borrador guardado — 2026-10-17

El resultado real de crear un borrador se conserva en el componente del proyecto. Si el router cancela o falla al abrir el editor, se muestra «Abrir borrador guardado»; repetir la misma solicitud abre el mismo resultado, sin otro POST. Una solicitud incierta conserva su clave y un intervalo/carga/transcripción diferente obtiene otra. La respuesta debe corresponder al proyecto y a la carga solicitados. Un resultado tardío de otra carga se conserva identificado, sin navegar automáticamente; el de otro proyecto se descarta.

La lista de borradores distingue carga inicial, consulta fallida, lista vacía confirmada y filas de una consulta anterior. Su actualización independiente no recarga la fuente ni el pipeline. Un 403/404 de proyecto o lista limpia metadatos anteriores, resultado de creación, fuentes y referencias, invalidando las consultas de inspección/pipeline pendientes. Las mutaciones comprueban el rol dentro del componente; lector conserva consulta. La vista de diseño no solicita datos ni permite mutaciones, conserva el regreso a /design/projects y no muestra tiempos predeterminados como si fueran de una fuente inspeccionada.

La carga comprueba AbortSignal antes y después del hash y antes de confirmar. Si la intención llega después de cancelar, se intenta liberar esa carga antes del PUT; un fallo de liberación informa su ID y permite consultar/reintentar. No se afirma cancelación exitosa ante un fallo del servidor. El componente mantiene su cancelación existente para una transferencia ya iniciada. Los grants tardíos de otro proyecto/pipeline no inician descargas.

100 pruebas pasan con Node 24.19.0, incluidas reapertura tras navegación cancelada/fallida, idempotencia, cambio de fuente/proyecto, error/reintento independiente de lista, denegación de acceso, permisos reader/design y cancelación antes/durante hash o intención. La suite también conserva las comprobaciones de registro privado, retorno seguro de login, guard de sesión y permisos de workspace; no equivale a una aceptación integrada de todo ese recorrido. Typecheck y build aprobados.

Se volvió a consultar GET http://localhost:3000/v1/health/ready: ECONNREFUSED. No se inició runtime ni se editó backend, migraciones o contratos; no se afirma haber probado un arranque del stack. La prueba con cuenta/workspace/proyecto/video reales continúa bloqueada por la API apagada. Las confirmaciones QA existentes siguen vigentes. No se presentan precios o suscripciones como activos.

Una única revisión visual de cierre de /design/projects/structure a 1440×1000 y 390×844 confirmó ausencia de overflow horizontal, campos de tiempo vacíos y cero borradores/recibos ficticios; consola sin errores/advertencias. Capturas: C:/Users/USER/Documents/Codex/artifacts/autoclipper-project-handoff-2026-10-17/desktop-empty.jpg y mobile-empty.jpg. El resultado poblado se valida solo con fixtures de DTO en tests mientras la API está apagada.

## Guardar subtítulos y exportar la revisión — 2026-10-17

La acción explícita «Guardar y exportar» realiza PATCH con la versión/If-Match actual, conserva el borrador devuelto y solo entonces solicita POST /edits/{id}/renders con revisionVersion de esa nueva revisión. Una validación fallida o un 412 no solicita render. Si el render se rechaza, la revisión guardada permanece limpia y visible; se puede reintentar la exportación sin crear otra revisión. El rol se comprueba de nuevo después de guardar y los controles de composición se deshabilitan durante la operación.

El contrato público documenta el 201 de renders con ID de procesamiento, las exportaciones ligadas por editorRevisionId y los grants de descarga por artefacto. Se tipó el 201 directamente desde el contrato generado. La clave de idempotencia se conserva ante respuesta incierta y está ligada al ID/versión inmutable de la revisión; guardar o restaurar a otra revisión obtiene una clave distinta al exportar. Un recibo aceptado se conserva aunque falle la consulta de estado; las solicitudes conocidas pendientes conducen al panel de exportaciones, sin repetir el POST. La ausencia del recibo en la lista permite hasta cinco consultas automáticas acotadas; un error detiene el polling y se ofrece consulta manual. La generación de consulta impide que una respuesta antigua reemplace filas o errores nuevos.

La auditoría de los validadores reales de editor y processing encontró reglas que la UI aún no aplicaba: cues ordenados sin superposición y duración mínima de 0,01 s, marcas de tiempo limitadas a 14400 s, tamaño entero de 12–40 y descripción completa de hasta 65000 bytes UTF-8. Se validan antes del PATCH, sin ordenar ni truncar silenciosamente. Las superposiciones siguen visibles en filas separadas para corregirlas. El formato original omite framing; pantalla dividida exige formato fijo, identificador de carga y límites numéricos. La autorización/procedencia de fuentes y transcripciones sigue a cargo del servidor.

Las descargas solo usan artefactos realmente listados de exportaciones terminadas. Sus etiquetas accesibles y nombres identifican la revisión; los cambios locales no alteran archivos anteriores. El transporte nativo sigue sin credenciales ni fallback, y un grant tardío de otra edición no inicia una descarga. Se inyecta únicamente la función de descarga para verificar ese límite en tests, conservando la implementación nativa en producción.

92 pruebas pasan con Node 24.19.0, incluyendo orden/duración de cues, guardado seguido de render, conflicto, rechazo comercial, respuesta incierta, restauración con clave nueva, consulta fallida tras aceptación, respuestas fuera de orden, rol revocado, lector, descargas de artefactos existentes, límite UTF-8 y formato original. Typecheck, build de producción y comparación del contrato con upstream aprobados. Los fixtures viven solo en tests; no se ha presentado una exportación simulada como resultado del servidor.

Una comprobación GET http://localhost:3000/v1/health/ready terminó con ECONNREFUSED. Ese es el bloqueo concreto para la prueba integrada de video real; no se arrancó ningún servicio ni se modificaron backend/infra. Se mantienen pendientes la aceptación de reproducción, guardado/render/descarga por UI y las invitaciones QA ya autorizadas. Una revisión visual final del estado vacío de Exportaciones a 1440×1000 y 390×844 confirmó documento sin overflow horizontal, controles deshabilitados y cero recibos/archivos ficticios; consola sin errores/advertencias. Capturas locales: C:/Users/USER/Documents/Codex/artifacts/autoclipper-editor-export-flow-2026-10-17/desktop-exports-empty.jpg y mobile-exports-empty.jpg.

## Reproducción vinculada a frases — 2026-10-17

El reproductor solicita el enlace de un video terminado de la lista autorizada. Cada enlace crea una instancia de video identificada; los eventos de una instancia anterior o de otra edición se descartan. La sincronización exige el ID inmutable de la revisión actual, formulario sin cambios pendientes y metadatos finitos compatibles con el intervalo del renderSpec guardado (tolerancia de 0,25 s por redondeo de medios). Una exportación antigua puede reproducirse con aviso, sin vincularle las frases actuales.

El botón «Ir a esta frase en el video» convierte tiempos absolutos de fuente a tiempos relativos del clip y busca sin autoplay. Solo vincula frases presentes en los cues resueltos del render guardado, con texto y extremos coincidentes dentro del clip. El avance real del reproductor mueve la línea y resalta todas las frases superpuestas activas, sin modificar la selección de edición ni ensuciar el formulario. Un fallo de medios permite solicitar un enlace nuevo mediante la misma API autorizada; no agrega fallback con credenciales.

79 pruebas aprobadas con Node 24.19.0: incluyen conversión, extremos recortados, superposición, metadatos inválidos, revisión antigua/no identificada, cambios sin guardar, guardado creando otro ID de revisión, consulta por lector, renovación de enlace, URLs inválidas y respuestas/eventos tardíos. Son fixtures de DTO en tests; no acreditan reproducción real por UI. La primera ejecución detectó un import del compilador faltante en el nuevo test y un fixture de navegación que omitía la aprobación del guard; ambos se corrigieron antes de la ejecución completa aprobada. Contrato público comprobado contra upstream.

La API/Docker permanece apagada. La aceptación con video real y los roles QA siguen pendientes, conservando las confirmaciones ya registradas. No se modifican backend ni infraestructura.

Revisión visual del estado vacío a 1440×1000 y 390×844: sin desbordamiento horizontal (ancho del documento igual al viewport útil), sin video ni acciones de búsqueda ficticias. Se amplió a 11 px el texto del marco y de ayuda del reproductor. Capturas locales: C:/Users/USER/Documents/Codex/artifacts/autoclipper-editor-playback-2026-10-17/desktop-empty.jpg y mobile-empty.jpg. Typecheck y build de producción aprobados; la reproducción con contenido todavía requiere aceptación contra la API activa.

## Edición de cues en el timeline — 2026-10-17

La pista permite seleccionar frases con ratón, teclado (flechas, Inicio/Fin) o selector nativo. El editor de frase se comparte con el panel y actualiza un único formulario. Texto y tiempos se validan antes de persistir; una copia editable explícita transforma la transcripción vinculada en cues aportados por el usuario dentro del clip, conservando el análisis original.

Setenta pruebas pasan, incluyendo selección sin cambios pendientes, sincronización local, rechazo de datos inválidos sin escritura, permisos reader/editor, bloqueo durante guardado, ETag, conflicto 412, restauración y respuestas tardías de transcripción. También se comprueban superposiciones, límites, copia sin mutación ni truncado, texto simple y duración fraccional de fuente. Typecheck, build y contracts:check aprobados.

Una pasada visual del estado vacío en /design/editor a 1440×1000 y 390×844 confirmó que no hay desbordamiento horizontal, cues ficticios ni tiempos predeterminados en el timeline. El foco de teclado está visible. Capturas locales: C:/Users/USER/Documents/Codex/artifacts/autoclipper-editor-cues-2026-10-17/desktop-empty.jpg y mobile-empty.jpg. La API/Docker permanece apagada; la edición poblada se verificó con fixtures de DTO solo en tests, no mediante guardado real por UI. No se reinició ni modificó backend/infra ni se reabrieron las invitaciones QA.

## Comprobaciones independientes del backend

Compilación Angular 22.2.3 con Node 24.21.0 y TypeScript 6.0.3: **aprobada**. Typecheck `ngc -p tsconfig.app.json --noEmit`: **aprobado**. Bundle inicial observado tras localización/Cobalto, edición por frases y ajuste de viewport del editor: 315.40 KB raw, 86.98 KB estimados de transferencia; feature editor lazy. No representa una medición de red de producción.

**19 pruebas aprobadas, cero fallos**: límites de dependencias core/shared, SHA del contrato generado, adquisición concurrente de CSRF, aislamiento de cookies/CSRF frente a almacenamiento y URLs parecidas, refresh concurrente preservando idempotencia/cuerpo, no replay de contraseña/factor, mensaje del bloqueo comercial sin evasión, conflicto 412 recuperable, dos pruebas del modelo de edición por frases y dos de descargas nativas sin credenciales/fallback. El transporte se prueba con `HttpTestingController` oficial: son respuestas explícitas de prueba, separadas de la aceptación real.

Se corrigieron errores iniciales de tipos/plantillas y un fallo del harness de pruebas sin DOM. Los resultados anteriores fallidos no se presentan como aprobados; las ejecuciones completas posteriores quedaron verdes.

## Aceptación local real

Suite propia `tests/live/workflow.test.mjs`, contra el stack existente y saludable, sin arrancar/detener servicios ni editar backend/infra. Resultado: **7 tests aprobados contando el padre, 6 subcasos, cero fallos; 64.5 segundos**.

1. Cuenta propia `example.test`, verificación mediante Mailpit local, login, espacio personal, creación/listado de proyecto.
2. MP4 generado con FFmpeg y voz sintética declarada del fixture backend; PUT firmado real, confirmación e inspección real.
3. Una intención pipeline ejecutó audio → **whisper.cpp real** → render; idempotencia, estado aceptado y descargas MP4/SRT/VTT comprobadas por SHA-256. Intervalo elegido manualmente; no acredita selección automática.
4. Borrador ligado al análisis real, ETag, actualización, rechazo 412 a escritura obsoleta, restauración y tres revisiones conservadas.
5. Exportación real de la revisión guardada, comentario, solicitud de revisión y aprobación autorizada.
6. Consumo mayor que cero, reserva conciliada a cero y nueve movimientos del pipeline; otra cuenta fue denegada en editor, descarga y consumo.

Los IDs/email sintéticos de la ejecución se conservan en `.local/acceptance/result.json`, ignorado por Git. No se guardaron cookies, tokens de sesión, URI 2FA ni URLs firmadas. El MP4 fuente propio queda en `.local/acceptance/source.mp4`. El proyecto QA se dejó identificado para revisión, sin presentarlo como material de un cliente. El password de fixtures está declarado explícitamente en la suite y nunca debe usarse para una cuenta real.

Esta suite valida contratos/backend reales, **no todo el recorrido por clicks del frontend**. Por separado, se verificó en navegador el login Angular de esa cuenta y que el panel mostrara el proyecto real y su rol. El alta inicial de espacios, acciones completas de 2FA/privacidad, multipart, todas las variantes de split y revisiones de largo historial no tienen todavía aceptación de UI exhaustiva.

## Revisión visual

Se observaron en navegador la animación anterior original, landing nueva, panel/estados vacíos y estructura de editor. Escritorio 1280×720 y móvil 390×844. La primera revisión móvil reveló que el CSS lazy sobreescribía media queries; se introdujeron capas `base, components, responsive` y se volvió a comprobar: panel en una columna, navegación móvil operativa y sin overflow horizontal. No hubo errores de consola en las vistas comprobadas.

Próximas verificaciones: controles del editor real por navegador, reproductor de exportación, variantes de seguridad y responsive de todos los formularios. La administración sigue siendo una estructura prevista; no existe aceptación administrativa frontend. No se declara producción lista ni auditoría completa de accesibilidad/carga.

La aceptación E2E terminó antes de la ventana coordinada de actualización del backend. No quedó proceso de aceptación activo; las revisiones de diseño y build pueden continuar sin servicios de negocio.

Las capturas de Cobalto aprobado están guardadas en `docs/evidence/`: landing, panel y editor de escritorio/móvil, además de estructura administrativa. Los tokens observados en navegador son `#2354BB`, `#183E90`, `#EDF2FC` y fondo `rgb(255,255,255)`. El selector de propuestas se retiró tras la aprobación. El editor de escritorio fue ajustado y comprobado con preview/inspector/timeline dentro del viewport, sin hacer scroll sobre toda la página.

## Continuación del 16 de octubre

Build de producción y typecheck aprobados con Node 24.21.0. Quince pruebas pasan: se añadieron la sincronización de límites del timeline tras cargar un borrador real de forma asíncrona, ciclo/pausa/movimiento reducido/limpieza y contraste de acentos. El SHA se verifica contra el snapshot público registrado para permitir reproducir este checkpoint aislado.

Se volvió a iniciar únicamente el servidor frontend en localhost:4200 porque estaba apagado. En navegador se observó el ciclo rosado/morado, fondo blanco y token global Cobalto fijo; la pausa mostró «Reanudar animaciones» y conservó el acento. La API localhost:3000 rechazó conexión en esta sesión. Por ello no se repitió la aceptación real ni se afirma haber validado reproducción/descarga privada por UI en esta continuación. La aceptación local anterior permanece como evidencia histórica. No se arrancaron ni modificaron servicios backend.

Capturas actuales: `evidence/landing-logo-v4-accent-desktop.jpg` (1280×720) y `evidence/landing-logo-v4-accent-mobile.jpg` (390×844). El panel público también se volvió a comprobar: Cobalto `#2354bb`, fondo blanco y ningún host de landing. La anchura móvil no desborda el viewport. Se restauró el tamaño normal del navegador y se dejó el ciclo reanudado.

### Edición por frases: validación inmediata

Cada frase muestra errores de tiempo y texto junto al campo correspondiente mediante `aria-invalid`/`aria-describedby`, contador de caracteres e intervalo original del clip. Guardar desde subtítulos se deshabilita mientras haya frases inválidas; guardar desde otras herramientas mantiene la misma validación antes de cualquier petición. La prueba de estado cubre corrección del texto/tiempos, invalidación al cambiar el intervalo y retirada de subtítulos. Quince pruebas pasan. Build y typecheck aprobados. La revisión visual pública final cubrió escritorio/móvil sin desbordamiento; no se introdujeron frases ficticias en la aplicación para simular el backend pausado. La revisión detectó además un enlace literal incorrecto `/vm.design` en el rail y se corrigió a `/design` o `/app` según modo. Captura de estructura: `evidence/editor-captions-desktop.jpg`. El guardado real por UI sigue pendiente con el backend disponible.

### Protección del editor y continuidad de proyectos/cargas

Diecisiete pruebas pasan. Se verificó que cancelar el descarte impide consultar/sustituir el formulario; aceptar lo recarga y el formulario limpio sale sin aviso. La ruta usa canDeactivate y el cierre/recarga del navegador usa beforeunload, cuya presentación queda bajo control del navegador. Un fallo de paginación conserva historial/cursor y muestra el error recuperable.

Las pruebas de proyectos cubren respuestas diferidas de inspección/pipeline tras cambiar IDs, invalidación inmediata de selección, bloqueo de creación sin inspección, vínculo de transcripción solo para una intención conocida de la carga actual y claves idempotentes estables en reintentos pero distintas al cambiar de carga. La validación de archivo acepta MIME vacío por extensión admitida (caso Windows/MKV), rechaza tipos explícitamente incompatibles y conserva límite de 100 MiB. No reemplaza inspección real.

Build final aprobado: bundle inicial 315.46 KB raw, unos 87.03 KB estimados de transferencia. Typecheck aprobado. Revisión pública breve del historial a 1280×720 y 390×844, sin desbordamiento; captura `evidence/editor-history-desktop.jpg`. Los escenarios con datos se comprobaron con fixtures explícitos de unitarias, nunca agregados al producto. La API local rechazó conexión en esta continuación; quedan bloqueadas la prueba real por UI de guardar/restaurar, carga/inspección/pipeline y reproducción/descarga. No se iniciaron ni reiniciaron servicios.

### Perfil, 2FA y ledger

Diecinueve pruebas pasan, incluido el helper de zonas horarias IANA. Perfil valida la zona con `Intl`, muestra «Descartar cambios» y conserva valores del servidor tras guardar. El secreto temporal de alta MFA presenta cuenta regresiva usando el vencimiento del servidor; al vencer se limpia URI, código y contraseña. Al abandonar Seguridad también se borran URI/códigos en memoria. La estructura pública mantiene controles deshabilitados. El ledger traduce etapas y movimientos conocidos y acorta el ID visual con el valor íntegro disponible como título.

Build de producción y typecheck aprobados. No fue posible hacer la revisión visual final en esta sesión: el navegador local está deshabilitado en ajustes de Work. El servidor API continúa sin responder, por lo que los cambios de perfil, MFA, sesiones, privacidad y ledger no tienen validación real por UI en esta ejecución.

### Recuperación de sesión

Veintiuna pruebas pasan. La restauración propaga fallos 5xx/red y libera el intento compartido para que se pueda reintentar; solo un 401 tras refresh se trata como sesión vencida. El guard distingue ambos caminos, conserva `returnUrl` y añade `connection=unavailable` para el aviso existente. Build y typecheck aprobados; bundle inicial 315.62 KB raw, 87.02 KB estimados. Revisión visual no disponible en este turno porque Work deshabilita el control local del navegador.

El guard del selector de espacios también conserva `returnUrl` si su petición falla después de restaurar la sesión. Veintidós pruebas pasan; build y typecheck aprobados. Bundle inicial 315.64 KB raw, ~87.00 KB estimados.

La carga inicial de configuración usa resultados independientes: un fallo de privacidad conserva perfil, 2FA y sesiones disponibles y muestra cuál sección falló. Una prueba con fallo explícito de una sola sección lo verifica. Veintitrés pruebas pasan, typecheck y build aprobados (315.64 KB raw, 87.03 KB transferencia estimada). No se pudo revisar visualmente porque Work bloqueó el navegador local.

### Carga parcial inicial del editor

Si falla una consulta secundaria al abrir un borrador, el editor conserva la composición cargada, muestra un aviso de las secciones afectadas y ofrece reintentar la carga. La prueba de estado fuerza un fallo del historial y verifica que el borrador permanece disponible sin convertir la carga parcial en un error fatal. En esta continuación el gateway local respondió 200 en `/v1/health/live` y `/v1/health/ready`; el snapshot OpenAPI coincide byte a byte con el contrato público central. Pasan las 23 pruebas, typecheck y build de producción (315.64 KB raw, 87.01 KB transferencia estimada). No se repitió una aceptación E2E que crea recursos locales ni una ronda visual.

### Concurrencia al guardar/restaurar revisiones

PATCH y restore ahora consumen las respuestas HTTP completas para conservar el `ETag` cuando el servidor lo envía, y derivan el valor entre comillas de `draft.version` según la definición del contrato cuando no hay header. Ambos envían `If-Match` en las siguientes escrituras. La prueba verifica el token enviado en dos guardados consecutivos y una restauración, además de la preferencia por el header explícito. 24 pruebas aprobadas; typecheck y build aprobados. El gateway responde 200 en readiness; no se ejecutó una escritura real sobre un proyecto persistido.

### Recorrido de proyectos, editor y consumo

El editor consulta el proyecto real asociado al borrador, conserva borrador y formulario cuando falla una sección auxiliar, mantiene `If-Match` al guardar/restaurar, y ofrece recarga explícita para conflictos 412. Consumo y ledger ahora cargan por separado: si falla un endpoint, se conserva el resultado disponible y se identifica la sección incompleta. Los errores distinguen credenciales de login, sesión vencida, rechazo CSRF y falta de conexión. La carga/procesamiento sigue usando IDs y estados devueltos por la API; no hay progreso numérico inventado. Estas mejoras se validaron con 26 pruebas unitarias/arquitectura, typecheck y build. No se escribieron proyectos reales ni se repitió la aceptación integral que deja recursos locales.

### Colaboración y revisión compartida de clips

El editor ahora consume las rutas contractuales para solicitar/devolver/aprobar una revisión versionada, registrar y retirar comentarios con marca temporal, emitir/revocar enlaces, paginar auditoría y listar aprobaciones. La vista pública `/review/:token` solo consulta el grant, sus subtítulos autorizados y comentarios; solo pide el permiso temporal de video cuando el grant declara que lo incluye. Las lecturas públicas omiten cookies de cuenta y refresh; se aplica `no-referrer`. El token de creación vive solo en memoria y se muestra en el resultado de creación; si se cierra esa vista no puede recuperarse.

Límites del contrato: un comentario-respuesta es una nueva observación en la misma marca (no hay campo de hilo), la vista pública no tiene endpoint para escribir observaciones, la lista de enlaces no pagina y comentarios/auditoría usan cursor con máximo de 50 por página. Las aprobaciones y permisos se presentan tal como los devuelve o permite el servidor, sin inferir roles. La auditoría muestra solo detalles permitidos de IDs/versiones; nunca texto de comentarios ni tokens. La cobertura de esta entrega es por mapeo de rutas, estado y aislamiento de credenciales, no una escritura E2E en datos de usuario.
