import { Routes } from "@angular/router";
export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./pages/editor.component").then((m) => m.EditorComponent),
  },
  {
    path: ":id",
    loadComponent: () =>
      import("./pages/editor.component").then((m) => m.EditorComponent),
  },
];
