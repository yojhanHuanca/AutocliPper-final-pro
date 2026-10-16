import { Routes } from "@angular/router";
export const routes: Routes = [
  { path: 'auth/verify', data: { mode: 'verify' }, loadComponent: () => import('./pages/auth.component').then(m => m.AuthComponent) },
  { path: 'auth/password/reset', data: { mode: 'reset' }, loadComponent: () => import('./pages/auth.component').then(m => m.AuthComponent) },
  ...["login", "register", "verify", "forgot", "reset"].map((mode) => ({
    path: mode,
    data: { mode },
    loadComponent: () =>
      import("./pages/auth.component").then((m) => m.AuthComponent),
  })),
];
