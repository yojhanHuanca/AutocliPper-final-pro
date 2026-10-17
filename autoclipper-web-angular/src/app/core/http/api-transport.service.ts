import { HttpClient, HttpContext } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { API_BASE_URL } from "../config/api-config.token";
import { API_AUTHENTICATED } from "./api-auth-context";
@Injectable({ providedIn: "root" })
export class ApiTransport {
  private readonly http = inject(HttpClient);
  readonly base = inject(API_BASE_URL);
  get<T>(path: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`));
  }
  getPublic<T>(path: string): Promise<T> {
    return firstValueFrom(
      this.http.get<T>(`${this.base}${path}`, {
        withCredentials: false,
        context: new HttpContext().set(API_AUTHENTICATED, false),
      }),
    );
  }
  post<T>(path: string, body: unknown, key?: string): Promise<T> {
    return firstValueFrom(
      this.http.post<T>(`${this.base}${path}`, body, {
        headers: key ? { "Idempotency-Key": key } : {},
      }),
    );
  }
  postResponse<T>(path: string, body: unknown, etag?: string) {
    return firstValueFrom(
      this.http.post<T>(`${this.base}${path}`, body, {
        observe: "response",
        headers: etag ? { "If-Match": etag } : {},
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
  patchResponse<T>(path: string, body: unknown, etag?: string) {
    return firstValueFrom(
      this.http.patch<T>(`${this.base}${path}`, body, {
        observe: "response",
        headers: etag ? { "If-Match": etag } : {},
      }),
    );
  }
  delete<T>(path: string): Promise<T> {
    return firstValueFrom(this.http.delete<T>(`${this.base}${path}`));
  }
  deleteWithBody<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.delete<T>(`${this.base}${path}`, { body }));
  }
  getResponse<T>(path: string) {
    return firstValueFrom(
      this.http.get<T>(`${this.base}${path}`, { observe: "response" }),
    );
  }
}
