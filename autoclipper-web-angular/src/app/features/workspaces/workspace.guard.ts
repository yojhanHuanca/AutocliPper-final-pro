import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { WorkspaceStore } from "./data-access/workspace.store";
export const workspaceGuard: CanActivateFn = async () => {
  const workspace = inject(WorkspaceStore);
  const router = inject(Router);
  try {
    await workspace.loadWorkspaces();
    return true;
  } catch {
    return router.createUrlTree(["/login"], {
      queryParams: { connection: "unavailable" },
    });
  }
};
