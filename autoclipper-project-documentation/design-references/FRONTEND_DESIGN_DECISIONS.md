# Referencia de diseño para el frontend Angular

Preferencias expresadas por el usuario y registradas el 15 de octubre de 2026.

## Decisiones que deben conservarse

- El usuario aprueba las propuestas de estructura del panel de usuario y del panel administrativo ampliado como referencia de diseño, no como interfaces finales.
- Rechaza el fondo azul petróleo de ambos paneles. NO adoptar la paleta de estas imágenes como aprobada. El color de fondo y la paleta definitiva están pendientes de exploración y elección con el usuario.
- También rechazó propuestas previas violeta y marfil/lima. No asumir que otra paleta esté aprobada ni que deba conservarse menta.
- Podrán incorporarse más funciones durante el diseño, manteniendo contratos y validación del backend. Una imagen conceptual no demuestra funcionalidad implementada.
- Frontend Angular separado del backend NestJS. Interfaz profesional, adaptable, accesible y consistente en ambos paneles.

## Imágenes conservadas

- `user-dashboard-concept.png`: navegación lateral, proyectos recientes, biblioteca de clips, procesamiento y revisiones del equipo.
- `user-settings-concept.png`: perfil, seguridad/2FA/sesiones, preferencias, equipo, integraciones y privacidad.
- `clip-editor-concept.png`: clips a la izquierda, reproductor central, inspector a la derecha y timeline abajo; pantalla dividida, subtítulos, audio, historial y exportación sin scroll interminable. La vista previa interactiva debe validarse aparte del render del backend.
- `admin-dashboard-expanded-concept.png`: estructura ampliada aprobada como referencia. General (usuarios/equipos); operación (procesamiento/IA/publicaciones/integraciones); negocio (planes/facturación/consumo); confianza (soporte/privacidad/seguridad/auditoría); sistema (servicios/respaldos/contenido/configuración).
- `admin-settings-concept.png`: general, acceso y roles, procesamiento, planes, integraciones y retención; cambios con impacto revisable, motivo, autor y versión.

Las cifras, fotos, estados, planes y fechas de las imágenes son ilustrativos. No reutilizarlos como datos reales ni anunciar módulos pendientes como disponibles. Administradores requieren permisos propios; soporte no obtiene automáticamente acceso al contenido privado.

## Landing

El usuario quiere una landing larga, con animaciones conectadas y aspecto cinematográfico; no una página simple. Le interesan tijeras que cortan una cinta y transformaciones de contenido. Pidió revisar primero la animación de la web anterior.

Referencia anterior: `C:\estudio\4_ciclo\proyecto\2026-1-4c24-pi-3b\AutoClipper\user\frontend-react\src\components\AutoClipperPromo.jsx` y su CSS. Contiene cinco escenas automáticas: enlace escrito, carga, análisis/ondas, clips y exportación. Se inspeccionó su código; todavía no se acreditó inspección visual en navegador en esta conversación. No afirmar que se vio ejecutarse.

Al empezar frontend: leer este documento, revisar imágenes por su estructura, proponer nuevos fondos/paletas y validar con el usuario antes de fijar identidad visual. Mantener scroll natural y movimiento reducido.

## Imágenes y movimiento — requisito adicional del usuario

El usuario pide expresamente que la web no se vea vacía: incorporar imágenes relevantes y animaciones con acabado profesional. Landing con imágenes propias/autorizadas o generadas y composiciones del producto; evitar bloques gigantes vacíos y diseño exclusivamente textual. Paneles con miniaturas reales cuando haya contenido y estados vacíos ilustrados con acciones útiles, sin datos ficticios presentados como reales. Optimizar recursos responsive, carga diferida y movimiento; respetar prefers-reduced-motion, scroll natural, accesibilidad y rendimiento en móvil. Este requisito no aprueba la paleta anterior ni autoriza compras de assets.

## Decisión vigente de fondo — 15 de octubre de 2026

El usuario eligió explícitamente FONDO BLANCO. Esta decisión reemplaza las referencias anteriores a fondo pendiente: landing, panel de usuario y panel administrativo deben usar identidad clara con fondo blanco. Los colores de acento siguen pendientes; no considerar menta, coral u otros aprobados automáticamente. Mantener contraste accesible, imágenes y animaciones. El reproductor del editor puede tener una superficie oscura localizada para visualizar video, sin cambiar el fondo general claro.

## Acento aprobado — 16 de octubre de 2026

El usuario aprobó la opción azul que le mostró el chat frontend en su selector. Conservar fondo blanco y recuperar el nombre/tokens exactos de esa variante desde el frontend; no inventar otro azul ni restaurar fondo azul petróleo. El chat frontend debe documentar los valores exactos. Esta decisión reemplaza la condición de acento pendiente.

## Logo elegido provisionalmente — 16 de octubre de 2026

El usuario aprobó autoclipper-logo-concept-v4.png como logo del proyecto «por ahora». Utilizar esta versión (lente tecnológico, cinta azul envolvente y tijeras plateadas, AutoClipper con subtítulo) como identidad provisional del frontend. Las versiones v1–v3 son exploraciones descartadas para uso actual. El PNG aprobado tiene fondo blanco: no afirmar transparencia ni formato vectorial. Conservar proporción y legibilidad; para espacios pequeños preparar una variante derivada coherente sin sustituir la identidad ni deformar el original.

## Animación de acentos en landing — 16 de octubre de 2026

Usuario autorizó ciclo azul → rosado → morado cada 3 segundos con transición suave SOLO en landing y fondo blanco. Paneles/editor mantienen Cobalto estable. Preservar colores semánticos de estados y contraste; prefers-reduced-motion usa acento estático. Implementación encargada al chat frontend, pendiente de verificar visualmente.
