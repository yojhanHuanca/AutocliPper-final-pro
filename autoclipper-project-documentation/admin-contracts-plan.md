# Inventario y Plan de Contratos de Administración

## Estado de implementación (Actualizado 2026-11-01)

### Endpoints implementados y verificados

| Endpoint | Método | Permiso requerido | Estado | Pruebas |
|----------|--------|------------------|--------|---------|
| /v1/admin/access | GET | Ninguno (requiere sesión) | ✅ Implementado | ✅ Verificado |
| /v1/admin/access | POST | Ninguno (requiere sesión + MFA) | ✅ Implementado | ✅ Verificado |
| /v1/admin/users | GET | users.read | ✅ Implementado | ✅ Verificado |
| /v1/admin/workspaces | GET | workspaces.read | ✅ Implementado | ✅ Verificado |
| /v1/admin/jobs | GET | jobs.read | ✅ Implementado | ✅ Verificado |
| /v1/admin/consumption | GET | consumption.read | ✅ Implementado | ✅ Verificado |
| /v1/admin/audit | GET | audit.read | ✅ Implementado | ✅ Verificado |

### Permisos implementados

| Permiso | Descripción | Scope | Estado |
|--------|-------------|-------|--------|
| users.read | Lectura de usuarios (enumeración global) | Global | ✅ Implementado |
| workspaces.read | Lectura de espacios | Global o por workspace | ✅ Implementado |
| jobs.read | Lectura de trabajos | Global o por workspace | ✅ Implementado |
| consumption.read | Lectura de consumo | Global o por workspace | ✅ Implementado |
| audit.read | Lectura de auditoría administrativa | Global | ✅ Implementado |

### Funcionalidades del frontend

| Funcionalidad | Estado | Notas |
|---------------|--------|-------|
| Acceso y elevación de sesión | ✅ Implementado | Requiere MFA, 5 minutos de elevación |
| Resumen operativo | ✅ Implementado | Muestra permisos y alcance |
| Consulta de usuarios | ✅ Implementado | Paginación, filtros locales |
| Consulta de espacios | ✅ Implementado | Paginación, filtro por workspace |
| Consulta de trabajos | ✅ Implementado | Paginación, filtros por tipo/estado, filtro por workspace |
| Consulta de consumo | ✅ Implementado | Paginación, filtro por workspace |
| Consulta de auditoría | ✅ Implementado | Paginación, filtros locales, estados de resultado |
| Gestión de grants | ❌ No implementado | Requiere aprobación de seguridad |
| Acciones sobre workspaces | ❌ No implementado | Requiere aprobación de seguridad |
| Cancelar/reintentar trabajos | ❌ No implementado | Requiere endpoint seguro |
| Ajustes administrativos de consumo | ❌ No implementado | Requiere aprobación de seguridad |
| Tickets de soporte | ❌ No implementado | Requiere backend de soporte |
| Vista general operativa con métricas | ❌ No implementado | Requiere endpoints de salud |

### Seguridad

| Aspecto | Estado | Verificación |
|---------|--------|-------------|
| MFA requerido para grants | ✅ Implementado | Verificado en backend |
| Elevación de sesión de 5 minutos | ✅ Implementado | Verificado en backend |
| Rate limiting (30 req/min por actor) | ✅ Implementado | Verificado en backend |
| Rate limiting (120 req/min por IP) | ✅ Implementado | Verificado en backend |
| Revocación de grants | ✅ Implementado | Verificado en backend |
| Auditoría append-only | ✅ Implementado | Verificado en backend |
| Redacción de datos sensibles | ✅ Implementado | Verificado en backend |
| Limpieza de datos al expirar elevación | ✅ Implementado | Verificado en frontend |
| Limpieza de datos al cambiar permisos | ✅ Implementado | Verificado en frontend |

### Pruebas
**Nota:** Los endpoints de summary no existen actualmente. La UI actual muestra solo filas cargadas por página.

### 2. Gestión de grants administrativos

| Función | Endpoint requerido | Permiso | Servicio | Prioridad | Estado |
|---------|-------------------|---------|----------|-----------|--------|
| Conceder grant | POST /v1/admin/grants | grants.write | Identity | P0 | ❌ No existe |
| Revocar grant | DELETE /v1/admin/grants/:userId | grants.write | Identity | P0 | ❌ No existe |
| Listar grants | GET /v1/admin/grants | grants.read | Identity | P0 | ❌ No existe |
| Actualizar permisos/scope | PATCH /v1/admin/grants/:userId | grants.write | Identity | P0 | ❌ No existe |

**Estado actual:** Solo existe CLI owner para grants. No hay endpoints web.

**Riesgo:** Permitir auto-asignación de scope global desde web requiere diseño y autorización seguros. No implementar sin aprobación de seguridad.

### 3. Gestión de usuarios

| Función | Endpoint requerido | Permiso | Servicio | Prioridad | Estado |
|---------|-------------------|---------|----------|-----------|--------|
| Filtrar usuarios por estado | GET /v1/admin/users?verified= | users.read | Identity | P1 | ❌ No existe |
| Filtrar usuarios por MFA | GET /v1/admin/users?mfaEnabled= | users.read | Identity | P1 | ❌ No existe |
| Revocar sesión de usuario | DELETE /v1/admin/users/:userId/sessions | users.write | Identity | P0 | ❌ No existe |
| Forzar MFA reset | POST /v1/admin/users/:userId/mfa-reset | users.write | Identity | P0 | ❌ No existe |

**Estado actual:** Solo lectura básica paginada.

### 4. Gestión de workspaces

| Función | Endpoint requerido | Permiso | Servicio | Prioridad | Estado |
|---------|-------------------|---------|----------|-----------|--------|
| Listar miembros de workspace | GET /v1/admin/workspaces/:id/members | workspaces.read | Workspace | P1 | ❌ No existe |
| Revocar acceso de miembro | DELETE /v1/admin/workspaces/:id/members/:userId | workspaces.write | Workspace | P0 | ❌ No existe |
| Transferir propiedad | POST /v1/admin/workspaces/:id/transfer | workspaces.write | Workspace | P0 | ❌ No existe |
| Suspender workspace | POST /v1/admin/workspaces/:id/suspend | workspaces.write | Workspace | P0 | ❌ No existe |

**Estado actual:** Solo lectura de metadatos básicos.

**Riesgo:** Acciones sobre workspaces no deben exponer contenido privado del creador.

### 5. Gestión de trabajos

| Función | Endpoint requerido | Permiso | Servicio | Prioridad | Estado |
|---------|-------------------|---------|----------|-----------|--------|
| Filtrar por tipo de trabajo | GET /v1/admin/jobs?kind= | jobs.read | Project | P1 | ❌ No existe |
| Filtrar por estado | GET /v1/admin/jobs?status= | jobs.read | Project | P1 | ❌ No existe |
| Cancelar trabajo | POST /v1/admin/jobs/:id/cancel | jobs.write | Project | P0 | ❌ No existe |
| Reintentar trabajo fallido | POST /v1/admin/jobs/:id/retry | jobs.write | Project | P0 | ❌ No existe |

**Estado actual:** Solo lectura de estado persistido. No es cola en tiempo real.

**Riesgo:** Cancelar/reintentar requiere validación de estado, dueño, alcance, idempotencia y carreras.

### 6. Gestión de consumo

| Función | Endpoint requerido | Permiso | Servicio | Prioridad | Estado |
|---------|-------------------|---------|----------|-----------|--------|
| Ajustar presupuesto | POST /v1/admin/consumption/:workspaceId/adjust | consumption.write | Billing | P0 | ❌ No existe |
| Listar movimientos detallados | GET /v1/admin/consumption/:workspaceId/ledger | consumption.read | Billing | P1 | ❌ No existe (solo resumen) |
| Historial de ajustes | GET /v1/admin/consumption/adjustments | consumption.read | Billing | P0 | ❌ No existe |

**Estado actual:** Solo lectura de asignación actual.

**Riesgo:** Ajustes administrativos requieren validación de límites, concurrencia y auditoría.

### 7. Auditoría

| Función | Endpoint requerido | Permiso | Servicio | Prioridad | Estado |
|---------|-------------------|---------|----------|-----------|--------|
| Leer auditoría de acceso | GET /v1/admin/audit/access | audit.read | Identity | P0 | ❌ No existe (solo append-only interno) |
| Filtrar por actor | GET /v1/admin/audit/access?actor= | audit.read | Identity | P1 | ❌ No existe |
| Filtrar por permiso | GET /v1/admin/audit/access?permission= | audit.read | Identity | P1 | ❌ No existe |
| Filtrar por periodo | GET /v1/admin/audit/access?from=&to= | audit.read | Identity | P1 | ❌ No existe |

**Estado actual:** Auditoría existe en tabla admin_access_audit pero no tiene endpoint público.

**Riesgo:** No exponer contraseñas, factores, tokens, contenido privado.

### 8. Soporte y tickets

| Función | Endpoint requerido | Permiso | Servicio | Prioridad | Estado |
|---------|-------------------|---------|----------|-----------|--------|
| Crear ticket | POST /v1/admin/tickets | tickets.write | Nuevo servicio | P1 | ❌ No existe |
| Listar tickets | GET /v1/admin/tickets | tickets.read | Nuevo servicio | P1 | ❌ No existe |
| Actualizar ticket | PATCH /v1/admin/tickets/:id | tickets.write | Nuevo servicio | P1 | ❌ No existe |

**Estado actual:** No existe persistencia de tickets ni flujo real.

## Plan de implementación

### Fase 1: Mejoras de consulta existentes (sin nuevos endpoints)
- ✅ Mejorar UI de filtros locales (ya hecho)
- ✅ Mejorar diseño visual (ya hecho)
- ✅ Verificar accesibilidad (ya hecho)
- ✅ Validar seguridad (ya hecho)

### Fase 2: Endpoints de lectura adicionales (seguros)
1. **GET /v1/admin/audit/access** - Lectura paginada de auditoría existente
   - Permiso: audit.read (nuevo)
   - Servicio: Identity
   - Redacción: solo UUIDs, permisos, outcomes, timestamps
   - Prioridad: P0

2. **GET /v1/admin/grants** - Listado de grants existentes
   - Permiso: grants.read (nuevo)
   - Servicio: Identity
   - Solo lectura, no modificación
   - Prioridad: P0

### Fase 3: Endpoints de escritura (requieren diseño de seguridad)
1. **POST /v1/admin/grants** - Conceder grant
   - Requiere: permiso grants.write, MFA reciente, confirmación explícita
   - Prohibir auto-asignación de scope global
   - Prioridad: P0 (bloqueado hasta aprobación de seguridad)

2. **DELETE /v1/admin/grants/:userId** - Revocar grant
   - Requiere: permiso grants.write, MFA reciente, confirmación
   - Prioridad: P0

3. **POST /v1/admin/jobs/:id/cancel** - Cancelar trabajo
   - Requiere: validación de estado, dueño, alcance
   - Idempotencia y manejo de carreras
   - Prioridad: P0

### Fase 4: Funciones avanzadas (requieren más diseño)
- Ajustes de consumo
- Gestión de miembros de workspace
- Tickets de soporte
- Vista general operativa con métricas

## Matriz de decisión

| Función | ¿Existe endpoint? | ¿Es seguro implementar? | ¿Requiere aprobación? | Acción |
|---------|-------------------|------------------------|----------------------|--------|
| Consulta usuarios | ✅ | ✅ | No | Mejorar filtros locales |
| Consulta workspaces | ✅ | ✅ | No | Mejorar filtros locales |
| Consulta jobs | ✅ | ✅ | No | Mejorar filtros locales |
| Consulta consumo | ✅ | ✅ | No | Mejorar filtros locales |
| Auditoría lectura | ❌ | ✅ | No | Implementar endpoint |
| Listar grants | ❌ | ✅ | No | Implementar endpoint |
| Conceder grants | ❌ | ⚠️ | Sí | Bloqueado hasta aprobación |
| Cancelar jobs | ❌ | ⚠️ | Sí | Diseñar primero |
| Ajustar consumo | ❌ | ⚠️ | Sí | Diseñar primero |
| Tickets | ❌ | ❌ | Sí | No en alcance |

## Próximos pasos inmediatos

1. Implementar GET /v1/admin/audit/access (lectura de auditoría existente)
2. Implementar GET /v1/admin/grants (listado de grants)
3. Verificar que el frontend actual maneja correctamente todos los estados de seguridad
4. Documentar qué funciones requieren aprobación de seguridad antes de implementar
