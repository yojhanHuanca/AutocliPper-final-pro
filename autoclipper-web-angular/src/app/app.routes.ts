import { Routes } from "@angular/router";
import { workspaceGuard } from "./features/workspaces/workspace.guard";
import { sessionGuard } from "./core/guards/session.guard";
export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./layouts/public/public-layout.component").then(
        (m) => m.PublicLayoutComponent,
      ),
    children: [
      {
        path: "",
        pathMatch: "full",
        loadChildren: () =>
          import("./features/landing/landing.routes").then((m) => m.routes),
      },
      {
        path: "",
        loadChildren: () =>
          import("./features/auth/auth.routes").then((m) => m.routes),
      },
    ],
  },
  {
    path: "app",
    canActivate: [sessionGuard, workspaceGuard],
    loadComponent: () =>
      import("./layouts/workspace/workspace-layout.component").then(
        (m) => m.WorkspaceLayoutComponent,
      ),
    children: [
      {
        path: "",
        pathMatch: "full",
        loadChildren: () =>
          import("./features/dashboard/dashboard.routes").then((m) => m.routes),
      },
      {
        path: "projects",
        loadChildren: () =>
          import("./features/projects/projects.routes").then((m) => m.routes),
      },
      {
        path: "edits",
        loadChildren: () =>
          import("./features/editor/editor.routes").then((m) => m.routes),
      },
      {
        path: "consumption",
        loadChildren: () =>
          import("./features/consumption/consumption.routes").then(
            (m) => m.routes,
          ),
      },
      {
        path: "settings",
        loadChildren: () =>
          import("./features/settings/settings.routes").then((m) => m.routes),
      },
    ],
  },
  {
    path: "design/admin",
    loadComponent: () =>
      import("./layouts/administration/administration-layout.component").then(
        (m) => m.AdministrationLayoutComponent,
      ),
    children: [
      {
        path: "",
        loadChildren: () =>
          import("./features/administration/administration.routes").then(
            (m) => m.routes,
          ),
      },
    ],
  },
  {
    path: "design",
    data: { design: true },
    loadComponent: () =>
      import("./layouts/workspace/workspace-layout.component").then(
        (m) => m.WorkspaceLayoutComponent,
      ),
    children: [
      {
        path: "",
        pathMatch: "full",
        loadChildren: () =>
          import("./features/dashboard/dashboard.routes").then((m) => m.routes),
      },
      {
        path: "projects",
        loadChildren: () =>
          import("./features/projects/projects.routes").then((m) => m.routes),
      },
      {
        path: "editor",
        loadChildren: () =>
          import("./features/editor/editor.routes").then((m) => m.routes),
      },
      {
        path: "settings",
        loadChildren: () =>
          import("./features/settings/settings.routes").then((m) => m.routes),
      },
    ],
  },
  {
    path: "**",
    loadComponent: () =>
      import("./shared/ui/not-found/not-found.component").then(
        (m) => m.NotFoundComponent,
      ),
  },
];
