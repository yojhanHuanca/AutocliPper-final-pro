import { bootstrapApplication } from "@angular/platform-browser";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { provideRouter, withInMemoryScrolling } from "@angular/router";
import { AppComponent } from "./app/app.component";
import { routes } from "./app/app.routes";
import { API_BASE_URL } from "./app/core/config/api-config.token";
import { apiInterceptor } from "./app/core/http/api.interceptor";

import { LOCALE_ID } from "@angular/core";
import { registerLocaleData } from "@angular/common";
import localeEsPe from "@angular/common/locales/es-PE";
import { loadPublicConfig } from "./app/core/config/load-public-config";

async function start(): Promise<void> {
  const config = await loadPublicConfig();
  registerLocaleData(localeEsPe);
  await bootstrapApplication(AppComponent, {
    providers: [
      { provide: LOCALE_ID, useValue: "es-PE" },
      { provide: API_BASE_URL, useValue: config.apiBaseUrl },
      provideHttpClient(withInterceptors([apiInterceptor])),
      provideRouter(
        routes,
        withInMemoryScrolling({
          scrollPositionRestoration: "enabled",
          anchorScrolling: "enabled",
        }),
      ),
    ],
  });
}
void start().catch(() => {
  document.body.textContent =
    "No se pudo iniciar AutoClipper. Revisa la configuración pública y vuelve a cargar.";
});
