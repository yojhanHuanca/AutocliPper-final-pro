import { HttpBackend, HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { API_BASE_URL } from "../config/api-config.token";
import type { Schema } from "../contracts/api-types";
@Injectable({ providedIn: "root" })
export class ApiSecurity {
  private readonly raw = new HttpClient(inject(HttpBackend));
  private readonly base = inject(API_BASE_URL);
  private csrfToken = "";
  private csrfExpiresAt = 0;
  private csrfFlight?: Promise<string>;
  private refreshFlight?: Promise<void>;

  csrf(): Promise<string> {
    if (this.csrfToken && Date.now() < this.csrfExpiresAt)
      return Promise.resolve(this.csrfToken);
    return (this.csrfFlight ??= firstValueFrom(
      this.raw.get<Schema<"CsrfResponseDto">>(`${this.base}/auth/csrf`, {
        withCredentials: true,
      }),
    )
      .then((result) => {
        this.csrfToken = result.csrfToken;
        this.csrfExpiresAt = Date.now() + 25 * 60_000;
        return result.csrfToken;
      })
      .finally(() => {
        this.csrfFlight = undefined;
      }));
  }

  refresh(): Promise<void> {
    return (this.refreshFlight ??= this.csrf()
      .then((token) =>
        firstValueFrom(
          this.raw.post(
            `${this.base}/auth/refresh`,
            {},
            {
              withCredentials: true,
              headers: { "X-CSRF-Token": token },
            },
          ),
        ),
      )
      .then(() => undefined)
      .finally(() => {
        this.refreshFlight = undefined;
      }));
  }

  clear(): void {
    this.csrfToken = "";
    this.csrfExpiresAt = 0;
  }
}
