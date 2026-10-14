# Google Identity Services: contrato y límites

El adaptador de identidad usa `google-auth-library` 11.3.0 y `OAuth2Client.verifyIdToken` en el servidor. Comprueba firma con las claves públicas oficiales de Google, audiencia configurada, emisor y vencimiento. Además exige email verificado, nonce ligado al navegador y propósito, `azp` compatible cuando exista, vencimiento estricto y credencial emitida en los últimos diez minutos. La consulta de claves tiene timeout de cinco segundos y no reintenta en esa solicitud. No usa client secret ni guarda el ID token.

`GET /v1/auth/providers` indica si Google tiene un client ID configurado. Sin configuración, las operaciones de Google devuelven 503 `GOOGLE_NOT_CONFIGURED`; no recurren a un proveedor simulado. Un fallo de transporte del SDK se clasifica como dependencia no disponible. Una credencial inválida devuelve 401 sin diagnósticos sensibles.

## Flujo previsto para Angular

1. Obtener `GET /v1/auth/csrf` con cookies y conservar el token CSRF en memoria.
2. Enviar `POST /v1/auth/google/challenge` con `{ "purpose": "sign_in" }`, `Origin` y `X-CSRF-Token`. Devuelve `clientId`, `nonce` y `expiresInSeconds=300`; establece una cookie HttpOnly del nonce. Redis conserva su hash y propósito durante cinco minutos.
3. Inicializar GIS con ese `clientId`, `nonce`, callback JavaScript y `ux_mode: "popup"`. Enviar el `credential` recibido al backend mediante `POST /v1/auth/google`, JSON, `withCredentials: true`, Origin y CSRF. No enviar un ID de usuario ni un email como sustituto de la credencial.
4. Si el usuario tiene 2FA local, incluir `factor`. Cada intento posterior necesita un desafío y credencial nuevos una vez consumido el nonce. El servidor emite las mismas cookies HttpOnly y sesiones revocables que en el login con contraseña. No devuelve tokens de sesión en JSON.
5. Si responde `{ "verificationRequired": true }`, completar la verificación de correo enviada por SMTP y repetir el flujo. No existe sesión nueva hasta verificar.

El callback JavaScript elegido no requiere una redirección OAuth al backend. No se ha construido interfaz Angular ni una página de login alternativa. El endpoint recibe JSON desde Angular; no acepta el POST de formulario automático de GIS ni sustituye sus validaciones CSRF por campos enviados por el cliente.

## Identidades, vinculación y correo

La identidad externa usa la clave única `(provider, sub)`, con una cuenta Google como máximo por usuario. El email no es el identificador externo. Un cambio posterior del email de Google conserva el usuario y no modifica automáticamente su correo en AutoClipper.

Cuando no existe esa identidad externa, se crea una cuenta únicamente si no colisiona con un correo existente. La colisión devuelve 409 `ACCOUNT_LINK_REQUIRED`. Para vincular: iniciar sesión en la cuenta existente, pedir un desafío con `purpose=link` y enviar la credencial a `POST /auth/google/link` con contraseña y factor si está activo. El nonce se liga al ID de usuario y no se puede trasladar entre propósito de login y vinculación. No se vinculan cuentas automáticamente por coincidencia de correo.

Gmail o un correo verificado con `hd` de Google Workspace pueden crear una cuenta verificada. Para otros correos Google no es autoridad actual del dominio: AutoClipper exige una verificación SMTP independiente. Una nueva cuenta Google tiene un hash Argon2id de un valor aleatorio desconocido; puede establecer contraseña mediante recuperación por correo antes de usar las operaciones sensibles que la exigen. No se asigna una contraseña predeterminada. Desvinculación autoservicio y gestión de múltiples proveedores quedan pendientes.

## Configuración pública reutilizada

Por instrucción del propietario, se leyó exclusivamente la configuración pública relevante del proyecto anterior. El mismo client ID figuraba en el backend Spring y en el proveedor Google del frontend React. Se guardó en `.env.identity` para ejecución nativa y en `.env` de infraestructura para Docker, ambos ignorados. No se copiaron secretos OAuth ni se modificó el proyecto anterior. Los ejemplos versionados dejan `GOOGLE_CLIENT_ID` vacío.

La coincidencia y el uso previo en navegador indican compatibilidad prevista con GIS, pero no verifican el tipo de cliente en Google Cloud ni sus permisos actuales. El proyecto anterior referencia localhost:5173 y localhost:5183. Si el origen nuevo no está autorizado, agregar exactamente `http://localhost:4200` a **Authorized JavaScript origins** del cliente web existente. No añadir rutas de callback del backend para este flujo popup. En producción se necesitarán los orígenes HTTPS concretos.

## Evidencia

Las pruebas unitarias y la aplicación HTTP de integración usan firmas RSA y certificados de prueba explícitos, inyectados únicamente en la instancia de tests; el servicio entregado no contiene una opción para claves de prueba. Comprueban rechazo de firma ajena, aud/iss/exp/nonce/azp incorrectos, nonce de un uso y propósito ligado, colisión de correo, contraseña para vincular, identidad estable por sub, segundo factor local y verificación SMTP de correo externo. La prueba HTTP contra el stack entregado comprueba CSRF, configuración y rechazo de credenciales malformadas.

Estas pruebas **no satisfacen una aceptación externa de Google**. Quedan sin comprobar los orígenes habilitados en Google Cloud, el consentimiento y un inicio de sesión con credencial real de Google. El estado de integración externa es implementado sin verificación externa.

Ejecuciones observadas: once tests unitarios/HTTP aprobados con Node 24.21.0; primera suite completa Docker con 26 tests aprobados; ampliación específica con cinco subcasos y un padre aprobados después de aislar los límites de Redis por ejecución. Se verificó también la descarga real de claves públicas de Google, sin enviar credenciales de usuario. El historial del fallo 429 y corrección está en `stage-2.md`; no se relajaron límites de producción.

Fuentes primarias: [validación de ID tokens](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [referencia GIS JavaScript y nonce](https://developers.google.com/identity/gsi/web/reference/js-reference), [biblioteca oficial Node](https://github.com/googleapis/google-auth-library-nodejs).
