# Evidencia de la primera entrega

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
