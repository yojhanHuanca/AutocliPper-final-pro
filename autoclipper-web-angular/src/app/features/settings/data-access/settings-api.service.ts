import { Injectable, inject } from "@angular/core";
import { ApiTransport } from "../../../core/http/api-transport.service";
import type { Schema } from "../../../core/contracts/api-types";

export type PrivacyContributionScope = "identity" | "workspace" | "project" | "billing" | "media" | "analysis";
export type PrivacyContributionResult =
  | Schema<"PrivacyProfileExportDto">
  | Schema<"PrivacyWorkspaceExportDto">
  | Schema<"PrivacyProjectExportDto">
  | Schema<"PrivacyBillingExportDto">
  | Schema<"PrivacyMediaExportDto">
  | Schema<"PrivacyAnalysisExportDto">;
@Injectable({ providedIn: "root" })
export class SettingsApi {
  private readonly api = inject(ApiTransport);
  twitchLinkStatus() {
    return this.api.get<{ configured: boolean; linked: boolean; account: { id?: string; login?: string } | null }>("/auth/twitch/link");
  }
  linkTwitch() {
    return this.api.post<{ authorizationUrl: string; expiresInSeconds: number; scope: "editor:manage:clips" }>("/auth/twitch/link", {});
  }
  unlinkTwitch() {
    return this.api.delete<{ unlinked: boolean }>("/auth/twitch/link");
  }
  profile() {
    return this.api.get<Schema<"ProfileResponseDto">>("/auth/profile");
  }
  saveProfile(body: Schema<"UpdateProfileDto">) {
    return this.api.patch<{ version: number }>("/auth/profile", body);
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
  privacyContribution(
    id: string,
    scope: PrivacyContributionScope,
    body: Schema<"PrivacyProfileProofDto">,
    key: string,
  ) {
    const path = `/auth/privacy-requests/${encodeURIComponent(id)}/${scope === "billing" ? "billing" : scope}-export`;
    switch (scope) {
      case "identity": return this.api.post<Schema<"PrivacyProfileExportDto">>(path, body, key);
      case "workspace": return this.api.post<Schema<"PrivacyWorkspaceExportDto">>(path, body, key);
      case "project": return this.api.post<Schema<"PrivacyProjectExportDto">>(path, body, key);
      case "billing": return this.api.post<Schema<"PrivacyBillingExportDto">>(path, body, key);
      case "media": return this.api.post<Schema<"PrivacyMediaExportDto">>(path, body, key);
      case "analysis": return this.api.post<Schema<"PrivacyAnalysisExportDto">>(path, body, key);
    }
  }
  privacyManifest(id: string) {
    return this.api.get<Schema<"PrivacyRequestManifestDto">>(
      `/auth/privacy-requests/${encodeURIComponent(id)}/manifest`,
    );
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
