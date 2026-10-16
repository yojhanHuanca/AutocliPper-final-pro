import { Injectable, inject } from "@angular/core";
import { ApiTransport } from "../../../core/http/api-transport.service";
import type { Schema } from "../../../core/contracts/api-types";
@Injectable({ providedIn: "root" })
export class SettingsApi {
  private readonly api = inject(ApiTransport);
  profile() {
    return this.api.get<Schema<"ProfileResponseDto">>("/auth/profile");
  }
  saveProfile(body: Schema<"UpdateProfileDto">) {
    return this.api.patch<Schema<"ProfileResponseDto">>("/auth/profile", body);
  }
  mfa() {
    return this.api.get<Schema<"MfaStatusResponseDto">>("/auth/2fa");
  }
  sessions() {
    return this.api.get<Schema<"SessionListResponseDto">>("/auth/sessions");
  }
  revoke(id: string) {
    return this.api.delete(`/auth/sessions/${encodeURIComponent(id)}`);
  }
  privacy() {
    return this.api.get<Schema<"PrivacyListResponseDto">>(
      "/auth/privacy-requests",
    );
  }
  requestPrivacy(body: Schema<"PrivacyRequestDto">) {
    return this.api.post("/auth/privacy-requests", body);
  }
  setupMfa(password: string) {
    return this.api.post<Schema<"MfaSetupResponseDto">>("/auth/2fa/setup", {
      password,
    });
  }
  enableMfa(body: Schema<"EnableMfaDto">) {
    return this.api.post<Schema<"MfaEnabledResponseDto">>(
      "/auth/2fa/enable",
      body,
    );
  }
  disableMfa(body: Schema<"FactorProofDto">) {
    return this.api.post("/auth/2fa/disable", body);
  }
  rotateCodes(body: Schema<"RequiredFactorProofDto">) {
    return this.api.post<Schema<"RecoveryCodesResponseDto">>(
      "/auth/2fa/recovery/rotate",
      body,
    );
  }
}
