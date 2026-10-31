# Coordinated redeploy note: Equipo y espacios

As of 2026-10-31, the Angular source and production build include the workspace team invitation states and Dashboard continuity updates. The Dashboard now retains its last confirmed lists during refresh and reloads workspace access after a denied request. The Docker-served frontend remains on its previously built image because containers were not restarted during these changes.

Schedule a coordinated redeploy window before expecting these UI changes at the Docker-served local URL. During that window, rebuild and replace only the web frontend image, then verify the Equipo y espacios route against the running gateway. The invitation list and revoke actions rely on the existing workspace API routes and their server-confirmed timestamps and response fields.
