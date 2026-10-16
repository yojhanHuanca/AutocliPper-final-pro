import { Routes } from "@angular/router";
export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./pages/projects.component").then((m) => m.ProjectsComponent),
  },
  {
    path: ":id",
    loadComponent: () =>
      import("./pages/project-detail.component").then(
        (m) => m.ProjectComponent,
      ),
  },
];
