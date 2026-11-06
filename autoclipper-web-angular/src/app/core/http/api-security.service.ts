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
  private generation = 0;
  private csrfFlight?: { generation: number; promise: Promise<string> };
  private refreshFlight?: { generation: number; promise: Promise<void> };

  csrf(): Promise<string> {
    if (this.csrfToken && Date.now() < this.csrfExpiresAt)
      return Promise.resolve(this.csrfToken);
    if (this.csrfFlight?.generation === this.generation) return this.csrfFlight.promise;
    const generation = this.generation;
    let promise: Promise<string>;
    promise = firstValueFrom(
      this.raw.get<Schema<"CsrfResponseDto">>(`${this.base}/auth/csrf`, {
        withCredentials: true,
      }),
    )
      .then((result) => {
        if (generation !== this.generation) throw new Error("La sesión cambió durante la validación de seguridad.");
        this.csrfToken = result.csrfToken;
        this.csrfExpiresAt = Date.now() + 25 * 60_000;
        return result.csrfToken;
      })
      .finally(() => {
        if (this.csrfFlight?.promise === promise) this.csrfFlight = undefined;
      });
    this.csrfFlight = { generation, promise };
    return promise;
  }

  refresh(): Promise<void> {
    if (this.refreshFlight?.generation === this.generation) return this.refreshFlight.promise;
    const generation = this.generation;
    let promise: Promise<void>;
    promise = this.csrf()
      .then((token) => {
        if (generation !== this.generation) throw new Error("La sesión cambió antes de renovar las credenciales.");
        return firstValueFrom(
          this.raw.post(
            `${this.base}/auth/refresh`,
            {},
            {
              withCredentials: true,
              headers: { "X-CSRF-Token": token },
            },
          ),
        );
      })
      .then(() => {
        if (generation !== this.generation) throw new Error("La sesión cambió durante la renovación de credenciales.");
      })
      .finally(() => {
        if (this.refreshFlight?.promise === promise) this.refreshFlight = undefined;
      });
    this.refreshFlight = { generation, promise };
    return promise;
  }

  clear(): void {
    this.generation += 1;
    this.csrfToken = "";
    this.csrfExpiresAt = 0;
    this.csrfFlight = undefined;
    this.refreshFlight = undefined;
  }
}
