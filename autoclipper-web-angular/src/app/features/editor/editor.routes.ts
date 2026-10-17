import { Routes } from "@angular/router";
import { editorChangesGuard } from './editor-changes.guard';
import { editorIdGuard } from './editor-id.guard';
export const routes: Routes = [
  {
    path: "",
    canDeactivate: [editorChangesGuard],
    loadComponent: () =>
      import("./pages/editor.component").then((m) => m.EditorComponent),
  },
  {
    path: ":id",
    canActivate: [editorIdGuard],
    canDeactivate: [editorChangesGuard],
    runGuardsAndResolvers: "paramsChange",
    loadComponent: () =>
      import("./pages/editor.component").then((m) => m.EditorComponent),
  },
];
