import { Routes } from "@angular/router";
export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./pages/dashboard.component").then((m) => m.DashboardComponent),
  },
];
