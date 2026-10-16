import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { API_BASE_URL } from "../config/api-config.token";
@Injectable({ providedIn: "root" })
export class ApiTransport {
  private readonly http = inject(HttpClient);
  readonly base = inject(API_BASE_URL);
  get<T>(path: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`));
  }
  post<T>(path: string, body: unknown, key?: string): Promise<T> {
    return firstValueFrom(
      this.http.post<T>(`${this.base}${path}`, body, {
        headers: key ? { "Idempotency-Key": key } : {},
      }),
    );
  }
  patch<T>(path: string, body: unknown, etag?: string): Promise<T> {
    return firstValueFrom(
      this.http.patch<T>(`${this.base}${path}`, body, {
        headers: etag ? { "If-Match": etag } : {},
      }),
    );
  }
  delete<T>(path: string): Promise<T> {
    return firstValueFrom(this.http.delete<T>(`${this.base}${path}`));
  }
  getResponse<T>(path: string) {
    return firstValueFrom(
      this.http.get<T>(`${this.base}${path}`, { observe: "response" }),
    );
  }
}
