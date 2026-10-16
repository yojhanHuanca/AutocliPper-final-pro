import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { SessionStore } from "../auth/session.store";

export const sessionGuard: CanActivateFn = async (_route, state) => {
  const session = inject(SessionStore);
  const router = inject(Router);
  try {
    if (await session.restore()) return true;
  } catch {
    return router.createUrlTree(["/login"], {
      queryParams: { returnUrl: state.url, connection: 'unavailable' },
    });
  }
  return router.createUrlTree(["/login"], { queryParams: { returnUrl: state.url } });
};
