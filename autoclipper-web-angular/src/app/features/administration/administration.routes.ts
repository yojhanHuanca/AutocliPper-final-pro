import { Routes } from "@angular/router";
export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./pages/administration.component").then((m) => m.AdminComponent),
  },
];
