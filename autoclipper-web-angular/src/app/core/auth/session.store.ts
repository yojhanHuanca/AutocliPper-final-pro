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
  private sessionVersion = 0;
  private restoring?: { version: number; promise: Promise<boolean> };
  private loginInProgress = false;
  private logoutInProgress = false;
  async restore(): Promise<boolean> {
    if (this.loginInProgress || this.logoutInProgress) return false;
    if (this.user()) return true;
    const version = this.sessionVersion;
    if (this.restoring?.version === version) return this.restoring.promise;
    let promise: Promise<boolean>;
    promise = this.api
      .get<Schema<"PublicUserDto">>("/auth/me")
      .catch(async (error) => {
        if (version !== this.sessionVersion) throw new Error("La sesión cambió durante la consulta.");
        if (!(error instanceof HttpErrorResponse) || error.status !== 401)
          throw error;
        await this.security.refresh();
        if (version !== this.sessionVersion) throw new Error("La sesión cambió durante la renovación.");
        return this.api.get<Schema<"PublicUserDto">>("/auth/me");
      })
      .then(async (user) => {
        if (version !== this.sessionVersion) return !!this.user();
        this.user.set(user);
        return true;
      })
      .catch((error) => {
        if (version !== this.sessionVersion) return !!this.user();
        if (error instanceof HttpErrorResponse && error.status === 401) return false;
        throw error;
      })
      .finally(() => {
        if (this.restoring?.promise === promise) this.restoring = undefined;
      });
    this.restoring = { version, promise };
    return promise;
  }
  async login(body: Schema<"LoginDto">): Promise<void> {
    if (this.logoutInProgress) throw new Error("Espera a que termine el cierre de sesión antes de volver a entrar.");
    const version = ++this.sessionVersion;
    this.loginInProgress = true;
    try {
      const result = await this.api.post<Schema<"LoginResponseDto">>(
        "/auth/login",
        body,
      );
      if (version !== this.sessionVersion) return;
      this.security.clear();
      this.user.set(result.user);
    } finally {
      if (version === this.sessionVersion) this.loginInProgress = false;
    }
  }
  async logout(): Promise<void> {
    if (this.loginInProgress) throw new Error("Espera a que termine el inicio de sesión antes de cerrar la cuenta.");
    if (this.logoutInProgress) return;
    const version = ++this.sessionVersion;
    this.logoutInProgress = true;
    try {
      await this.api.post("/auth/logout", {});
    } catch (error) {
      if (version === this.sessionVersion) this.logoutInProgress = false;
      throw error;
    }
    if (version !== this.sessionVersion) return;
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
    this.logoutInProgress = false;
  }
}
