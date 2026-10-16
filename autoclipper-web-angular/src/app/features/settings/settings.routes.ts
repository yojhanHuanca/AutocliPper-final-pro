import { Routes } from "@angular/router";
export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./pages/settings.component").then((m) => m.SettingsComponent),
  },
];
