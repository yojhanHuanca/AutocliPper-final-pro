import { inject } from "@angular/core";
import type { CanActivateFn } from "@angular/router";
import { EditorNavigationService } from "./state/editor-navigation.service";

export const editorIdGuard: CanActivateFn = (route) =>
  inject(EditorNavigationService).allowEdit(route.paramMap.get("id") ?? "");
