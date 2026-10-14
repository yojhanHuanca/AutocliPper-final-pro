# AutoClipper

Nueva implementación independiente del backend. **Entrega actual: etapa 1**, con un primer recorrido técnico real de inspección multimedia; todavía no incluye autenticación ni generación de clips con IA.

Verificado: 6 pruebas unitarias/HTTP, 10 casos de integración en Windows y Docker/Linux, auditoría npm sin hallazgos y dump/restore PostgreSQL en base temporal. El stack local queda levantado; Swagger en [gateway](http://localhost:3000/docs) y [media](http://localhost:3001/docs).

- [Guía local](autoclipper-project-documentation/local-development.md)
- [Arquitectura y decisiones](autoclipper-project-documentation/architecture.md)
- [Estado por requisito](autoclipper-project-documentation/status.md)
- [Evidencia de verificaciones](autoclipper-project-documentation/verification.md)
- [Plan de entregas](autoclipper-project-documentation/scope.md)

El frontend Angular se mantiene separado y no se implementa en este encargo. No se reutilizaron archivos, secretos ni historia del proyecto Java anterior. Durante el trabajo se detectó un commit inicial y un remoto GitHub configurados desde otra sesión; esta implementación conserva esa configuración y no ejecuta push.
