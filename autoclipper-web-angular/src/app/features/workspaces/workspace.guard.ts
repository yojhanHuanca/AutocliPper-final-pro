import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { WorkspaceStore } from "./data-access/workspace.store";
export const workspaceGuard: CanActivateFn = async (_route, state) => {
  const workspace = inject(WorkspaceStore);
  const router = inject(Router);
  try {
    await workspace.loadWorkspaces();
    return true;
  } catch {
    return router.createUrlTree(["/login"], {
      queryParams: { connection: "unavailable", returnUrl: state.url },
    });
  }
};
