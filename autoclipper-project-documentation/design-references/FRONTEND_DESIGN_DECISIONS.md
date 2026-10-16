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
