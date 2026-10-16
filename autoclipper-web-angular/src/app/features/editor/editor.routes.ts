import { Routes } from "@angular/router";
import { editorChangesGuard } from './editor-changes.guard';
export const routes: Routes = [
  {
    path: "",
    canDeactivate: [editorChangesGuard],
    loadComponent: () =>
      import("./pages/editor.component").then((m) => m.EditorComponent),
  },
  {
    path: ":id",
    canDeactivate: [editorChangesGuard],
    loadComponent: () =>
      import("./pages/editor.component").then((m) => m.EditorComponent),
  },
];
