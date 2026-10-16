# Evidencia de la primera entrega

## Comprobaciones independientes del backend

Compilación Angular 22.2.3 con Node 24.21.0 y TypeScript 6.0.3: **aprobada**. Typecheck `ngc -p tsconfig.app.json --noEmit`: **aprobado**. Bundle inicial observado tras localización/Cobalto, edición por frases y ajuste de viewport del editor: 315.40 KB raw, 86.98 KB estimados de transferencia; feature editor lazy. No representa una medición de red de producción.

**15 pruebas aprobadas, cero fallos**: límites de dependencias core/shared, SHA del contrato generado, adquisición concurrente de CSRF, aislamiento de cookies/CSRF frente a almacenamiento y URLs parecidas, refresh concurrente preservando idempotencia/cuerpo, no replay de contraseña/factor, mensaje del bloqueo comercial sin evasión, conflicto 412 recuperable, dos pruebas del modelo de edición por frases y dos de descargas nativas sin credenciales/fallback. El transporte se prueba con `HttpTestingController` oficial: son respuestas explícitas de prueba, separadas de la aceptación real.

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
