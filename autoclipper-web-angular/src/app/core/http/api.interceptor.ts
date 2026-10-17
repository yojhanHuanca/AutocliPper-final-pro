import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { catchError, from, switchMap, throwError } from "rxjs";
import { API_BASE_URL } from "../config/api-config.token";
import { ApiSecurity } from "./api-security.service";
import { API_AUTHENTICATED } from "./api-auth-context";
export const apiInterceptor: HttpInterceptorFn = (request, next) => {
  const base = inject(API_BASE_URL);
  // Exact origin AND base path boundary; signed storage requests bypass this interceptor.
  if (!request.url.startsWith(`${base}/`)) return next(request);
  if (!request.context.get(API_AUTHENTICATED)) return next(request);
  const security = inject(ApiSecurity);
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const send = (token?: string) => {
    const authorized = request.clone({
      withCredentials: true,
      ...(token ? { setHeaders: { "X-CSRF-Token": token } } : {}),
    });
    return next(authorized).pipe(
      catchError((error: unknown) => {
        // Authentication failures must not replay passwords or consume another recovery code.
        const authRequest = request.url.startsWith(`${base}/auth/`);
        if (
          !(error instanceof HttpErrorResponse) ||
          error.status !== 401 ||
          authRequest
        )
          return throwError(() => error);
        return from(security.refresh()).pipe(switchMap(() => next(authorized)));
      }),
    );
  };
  return mutation ? from(security.csrf()).pipe(switchMap(send)) : send();
};
