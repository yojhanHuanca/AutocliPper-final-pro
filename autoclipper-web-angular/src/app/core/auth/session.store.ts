import { Injectable, inject, signal } from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { ApiTransport } from "../http/api-transport.service";
import { ApiSecurity } from "../http/api-security.service";
import type { Schema } from "../contracts/api-types";
@Injectable({ providedIn: "root" })
export class SessionStore {
  private readonly api = inject(ApiTransport);
  private readonly security = inject(ApiSecurity);
  readonly user = signal<Schema<"PublicUserDto"> | null>(null);
  private restoring?: Promise<boolean>;
  async restore(): Promise<boolean> {
    if (this.user()) return true;
    return (this.restoring ??= this.api
      .get<Schema<"PublicUserDto">>("/auth/me")
      .catch(async (error) => {
        if (!(error instanceof HttpErrorResponse) || error.status !== 401)
          throw error;
        await this.security.refresh();
        return this.api.get<Schema<"PublicUserDto">>("/auth/me");
      })
      .then(async (user) => {
        this.user.set(user);
        return true;
      })
      .catch((error) => {
        if (error instanceof HttpErrorResponse && error.status === 401) return false;
        throw error;
      })
      .finally(() => {
        this.restoring = undefined;
      }));
  }
  async login(body: Schema<"LoginDto">): Promise<void> {
    const result = await this.api.post<Schema<"LoginResponseDto">>(
      "/auth/login",
      body,
    );
    this.user.set(result.user);
  }
  async logout(): Promise<void> {
    await this.api.post("/auth/logout", {});
    const userId = this.user()?.id;
    if (userId) {
      try {
        const prefix = `ac:resume:${userId}:`;
        for (let index = sessionStorage.length - 1; index >= 0; index--) {
          const key = sessionStorage.key(index);
          if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
        }
      } catch { /* Session cleanup must not block logout. */ }
    }
    this.user.set(null);
    this.security.clear();
  }
}
