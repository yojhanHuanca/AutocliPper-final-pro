import { DESIGN_MODE } from "../../../core/config/design-mode.token";
import { SettingsApi } from "../data-access/settings-api.service";
import type { PrivacyContributionScope } from "../data-access/settings-api.service";
import {
  ViewEncapsulation,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { HttpErrorResponse } from "@angular/common/http";
import { ActivatedRoute, RouterLink } from "@angular/router";
import type { Schema } from "../../../core/contracts/api-types";
import { SessionStore } from "../../../core/auth/session.store";
import { errorMessage } from "../../../core/http/api-error";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { isValidIanaTimezone } from '../models/timezone';
import { AccountSectionNavComponent } from '../../../shared/ui/account-section-nav/account-section-nav.component';
import { WorkspaceStore } from '../../workspaces/data-access/workspace.store';
import { workspaceRoleLabel } from '../../../core/labels/workspace-role-label';
import { AppearancePreferenceService, type AppearanceTheme } from '../../../core/preferences/appearance-preference.service';

const privacyScopeKeys: Record<Schema<"PrivacyScopeStatusDto">["scope"], PrivacyContributionScope> = {
  "identity-profile-v1": "identity",
  "workspace-memberships-v1": "workspace",
  "project-attribution-v1": "project",
  "consumption-attribution-v1": "billing",
  "media-task-attribution-v1": "media",
  "analysis-attribution-v1": "analysis",
};
const privacyScopeContracts: Record<PrivacyContributionScope, Schema<"PrivacyScopeStatusDto">["scope"]> = {
  identity: "identity-profile-v1",
  workspace: "workspace-memberships-v1",
  project: "project-attribution-v1",
  billing: "consumption-attribution-v1",
  media: "media-task-attribution-v1",
  analysis: "analysis-attribution-v1",
};
const privacyScopeNames: Record<PrivacyContributionScope, string> = {
  identity: "Identity · perfil y proveedor vinculado",
  workspace: "Workspace · membresías actuales",
  project: "Project · referencias y metadatos propios",
  billing: "Billing · reservas y movimientos de consumo propios",
  media: "Media · inspecciones y procesos atribuidos a ti",
  analysis: "Analysis · trabajos y presencia de transcripción/selección",
};

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-settings",
  imports: [FormsModule, DatePipe, IconComponent, RouterLink, AccountSectionNavComponent],
  templateUrl: "./settings.component.html",
  styleUrl: "./settings.component.css",
})
export class SettingsComponent {
  private readonly api = inject(SettingsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionStore);
  private readonly appearance = inject(AppearancePreferenceService);
  private readonly destroy = inject(DestroyRef);
  private setupTimer?: ReturnType<typeof setTimeout>;
  private alive = true;
  private securityVersion = 0;
  private sessionsVersion = 0;
  readonly setupSeconds = signal(0);
  readonly design = inject(DESIGN_MODE);
  readonly tabItems = ["Perfil", "Espacio de trabajo", "Seguridad", "Privacidad"] as const;
  readonly tab = signal("Perfil");
  readonly workspaceStore = inject(WorkspaceStore);
  readonly activeWorkspace = computed(() => this.workspaceStore.workspaces().find((workspace) => workspace.id === this.workspaceStore.workspaceId()) ?? null);
  readonly profile = signal<Schema<"ProfileResponseDto"> | null>(null);
  readonly mfa = signal<Schema<"MfaStatusResponseDto"> | null>(null);
  readonly sessions = signal<Schema<"SessionResponseDto">[]>([]);
  readonly sessionsLoaded = signal(false);
  readonly sessionsLoading = signal(false);
  readonly sessionsError = signal("");
  readonly pendingSessionRevocation = signal("");
  readonly privacy = signal<Schema<"PrivacyStatusResponseDto">[]>([]);
  readonly profileError = signal("");
  readonly mfaError = signal("");
  readonly privacyError = signal("");
  readonly privacyLoaded = signal(false);
  readonly privacyLoading = signal(false);
  readonly privacyManifest = signal<Schema<"PrivacyRequestManifestDto"> | null>(null);
  readonly privacyManifestLoading = signal(false);
  readonly privacyManifestError = signal("");
  readonly privacyContributionBusy = signal(false);
  readonly privacyContributionMessage = signal("");
  readonly privacyContributionError = signal("");
  readonly privacyExportRequestId = signal("");
  readonly privacyExportScope = signal<PrivacyContributionScope>("identity");
  private readonly privacyContributionKeys = new Map<string, string>();
  private privacyManifestGeneration = 0;
  readonly mfaLoading = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly message = signal("");
  readonly setupUri = signal("");
  readonly recoveryCodes = signal<string[]>([]);
  name = "";
  timezone = "America/Lima";
  locale: Schema<"ProfileResponseDto">["preferences"]["locale"] = "es";
  theme: AppearanceTheme = "system";
  emailNotifications = true;
  password = "";
  factor = "";
  privacyKind: "export" | "deletion" = "export";
  constructor() {
    this.destroy.onDestroy(() => {
      this.alive = false;
      this.securityVersion += 1;
      this.sessionsVersion += 1;
      this.privacyManifestGeneration += 1;
      this.password = "";
      this.factor = "";
      this.setupUri.set("");
      this.recoveryCodes.set([]);
      clearInterval(this.setupTimer);
    });
    if (!this.design) void this.load();
  }
  async load(): Promise<void> {
    await this.run(async () => {
      this.sessionsLoading.set(true);
      this.sessionsLoaded.set(false);
      this.pendingSessionRevocation.set('');
      this.profileError.set(""); this.mfaError.set(""); this.privacyError.set(""); this.sessionsError.set("");
      const results = await Promise.allSettled([
        this.api.profile(),
        this.api.mfa(),
        this.api.privacy(),
        this.api.sessions(),
      ]);
      if (!this.alive) return;
      const labels = ['perfil', 'autenticación en dos pasos', 'privacidad', 'sesiones'];
      const failures: string[] = [];
      if (results[0].status === 'fulfilled') {
        const profile = results[0].value;
        this.profile.set(profile);
        this.name = profile.name;
        this.timezone = profile.preferences.timezone;
        this.locale = profile.preferences.locale;
        this.theme = profile.preferences.theme;
        this.emailNotifications = profile.preferences.emailNotifications;
        this.appearance.applyFromProfile(profile.id, profile.preferences.theme);
      } else { this.profileError.set(errorMessage(results[0].reason)); failures.push(`${labels[0]}: ${this.profileError()}`); }
      if (results[1].status === 'fulfilled') this.mfa.set(results[1].value);
      else { this.mfa.set(null); this.mfaError.set(errorMessage(results[1].reason)); failures.push(`${labels[1]}: ${this.mfaError()}`); }
      if (results[2].status === 'fulfilled') { this.privacy.set(results[2].value.items); this.privacyLoaded.set(true); }
      else { this.privacyError.set(errorMessage(results[2].reason)); failures.push(`${labels[2]}: ${this.privacyError()}`); }
      if (results[3].status === 'fulfilled') { this.sessions.set(results[3].value.items); this.sessionsLoaded.set(true); }
      else { this.sessionsLoaded.set(false); this.sessionsError.set(errorMessage(results[3].reason)); failures.push(`${labels[3]}: ${errorMessage(results[3].reason)}`); }
      this.sessionsLoading.set(false);
      if (failures.length) this.error.set(`Algunos datos no se pudieron cargar. ${failures.join(' · ')}`);
    });
  }
  async saveProfile(): Promise<void> {
    await this.run(async () => {
      const profile = this.profile();
      if (!profile) return;
      const update = {
        version: profile.version,
        name: this.name.trim(),
        preferences: {
          locale: this.locale,
          timezone: this.timezone.trim(),
          emailNotifications: this.emailNotifications,
          theme: this.theme,
        },
      } satisfies Schema<"UpdateProfileDto">;
      const result = await this.api.saveProfile(update);
      if (!this.alive || this.session.user()?.id !== profile.id) return;
      const updated: Schema<"ProfileResponseDto"> = {
        ...profile,
        version: result.version,
        name: update.name,
        preferences: { ...profile.preferences, ...update.preferences },
      };
      this.profile.set(updated);
      this.name = updated.name;
      this.timezone = updated.preferences.timezone;
      this.locale = updated.preferences.locale;
      this.theme = updated.preferences.theme;
      this.emailNotifications = updated.preferences.emailNotifications;
      this.appearance.applyFromProfile(updated.id, updated.preferences.theme);
      const user = this.session.user();
      if (user) this.session.user.set({ ...user, name: updated.name });
      this.message.set("Perfil actualizado.");
    });
  }
  timezoneValid(): boolean {
    return isValidIanaTimezone(this.timezone);
  }
  workspaceRoleLabel(role: string): string {
    return workspaceRoleLabel(role);
  }
  resetProfile(): void {
    const profile = this.profile();
    if (!profile) return;
    this.name = profile.name;
    this.timezone = profile.preferences.timezone;
    this.locale = profile.preferences.locale;
    this.theme = profile.preferences.theme;
    this.emailNotifications = profile.preferences.emailNotifications;
    this.error.set('');
    this.message.set('Cambios descartados.');
  }
  selectTab(tab: string): void {
    if (!this.tabItems.includes(tab as (typeof this.tabItems)[number])) return;
    if (tab !== 'Seguridad') this.clearSensitive();
    this.tab.set(tab);
  }
  activeTabIndex(): number {
    return this.tabItems.indexOf(this.tab() as (typeof this.tabItems)[number]);
  }
  onTabKeydown(event: KeyboardEvent, index: number): void {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % this.tabItems.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index + this.tabItems.length - 1) % this.tabItems.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = this.tabItems.length - 1;
    else return;

    event.preventDefault();
    this.selectTab(this.tabItems[next]);
    requestAnimationFrame(() =>
      document.getElementById(`settings-tab-${next}`)?.focus(),
    );
  }
  hideSetup(): void { this.clearSensitive(); }
  private clearSensitive(): void {
    this.securityVersion += 1;
    clearInterval(this.setupTimer);
    this.setupTimer = undefined;
    this.setupSeconds.set(0);
    this.setupUri.set('');
    this.recoveryCodes.set([]);
    this.factor = '';
    this.password = '';
  }
  async loadSessions(): Promise<void> {
    if (this.design) return;
    const version = ++this.sessionsVersion;
    this.sessionsLoading.set(true);
    this.sessionsLoaded.set(false);
    this.pendingSessionRevocation.set('');
    this.sessionsError.set('');
    try {
      const result = await this.api.sessions();
      if (this.alive && version === this.sessionsVersion) { this.sessions.set(result.items); this.sessionsLoaded.set(true); }
    } catch (error) {
      if (this.alive && version === this.sessionsVersion) { this.sessionsLoaded.set(false); this.sessionsError.set(errorMessage(error)); }
    } finally {
      if (this.alive && version === this.sessionsVersion) this.sessionsLoading.set(false);
    }
  }
  privacyKindLabel(kind: Schema<'PrivacyStatusResponseDto'>['kind']): string {
    return kind === 'export' ? 'Exportación de datos' : 'Eliminación de datos';
  }
  exportablePrivacyRequests(): Schema<'PrivacyStatusResponseDto'>[] {
    return this.privacy().filter((item) => item.kind === "export" && (item.state === "requested" || item.state === "processing"));
  }
  availablePrivacyExportScopes(): Schema<"PrivacyScopeStatusDto">[] {
    return (this.privacyManifest()?.scopes ?? []).filter((scope) =>
      scope.required && scope.supported && scope.status !== "not_implemented",
    );
  }
  privacyScopeKey(scope: Schema<"PrivacyScopeStatusDto">["scope"]): PrivacyContributionScope {
    return privacyScopeKeys[scope];
  }
  privacyScopeName(scope: Schema<"PrivacyScopeStatusDto">["scope"]): string {
    return privacyScopeNames[this.privacyScopeKey(scope)];
  }
  privacyScopeStatusLabel(status: Schema<"PrivacyScopeStatusDto">["status"]): string {
    return ({
      pending: "Pendiente",
      prepared: "Preparado",
      owner_unavailable: "Servicio de datos no disponible",
      snapshot_changed: "Los datos cambiaron; vuelve a preparar",
      limit_exceeded: "Supera el límite",
      attribution_missing: "Atribución no disponible",
      not_implemented: "Aún no disponible",
    })[status];
  }
  selectPrivacyExportRequest(id: string): void {
    if (!this.exportablePrivacyRequests().some((item) => item.id === id) || id === this.privacyExportRequestId()) return;
    this.privacyExportRequestId.set(id);
    this.privacyManifest.set(null);
    this.privacyManifestError.set("");
    void this.loadPrivacyManifest(id);
  }
  selectPrivacyExportScope(scope: PrivacyContributionScope): void {
    if (this.availablePrivacyExportScopes().some((item) => privacyScopeKeys[item.scope] === scope))
      this.privacyExportScope.set(scope);
  }
  async loadPrivacyManifest(requestId = this.privacyExportRequestId()): Promise<void> {
    if (this.design || !this.alive || !requestId || !this.exportablePrivacyRequests().some((item) => item.id === requestId)) return;
    const generation = ++this.privacyManifestGeneration;
    const current = () => this.alive && generation === this.privacyManifestGeneration && requestId === this.privacyExportRequestId();
    this.privacyManifestLoading.set(true);
    this.privacyManifestError.set("");
    try {
      const manifest = await this.api.privacyManifest(requestId);
      if (!current()) return;
      if (manifest.requestId !== requestId || manifest.kind !== "export" || !["requested", "processing"].includes(manifest.requestState))
        throw new Error("El servidor devolvió un manifiesto distinto de la solicitud seleccionada.");
      this.privacyManifest.set(manifest);
      const available = this.availablePrivacyExportScopes();
      if (!available.some((scope) => privacyScopeKeys[scope.scope] === this.privacyExportScope()))
        this.privacyExportScope.set(available[0] ? privacyScopeKeys[available[0].scope] : "identity");
    } catch (error) {
      if (current()) {
        this.privacyManifest.set(null);
        this.privacyManifestError.set(errorMessage(error));
      }
    } finally {
      if (current()) this.privacyManifestLoading.set(false);
    }
  }
  privacyExportPrompt(): "loading" | "unconfirmed" | "empty" {
    if (this.busy() || this.privacyLoading()) return "loading";
    if (!this.privacyLoaded() || this.privacyError()) return "unconfirmed";
    return "empty";
  }
  privacyStateLabel(state: Schema<'PrivacyStatusResponseDto'>['state']): string {
    return ({ requested: 'Registrada · alcance global pendiente', processing: 'En proceso · alcance global pendiente', completed: 'Estado completado en Identity · purga global no verificada', rejected: 'Rechazada por Identity' })[state];
  }
  async revoke(id: string): Promise<void> {
    const session = this.sessions().find((item) => item.id === id);
    if (!this.alive || this.design || !this.sessionsLoaded() || !session || session.revokedAt || this.busy()) return;
    if (this.pendingSessionRevocation() !== id) {
      this.pendingSessionRevocation.set(id);
      return;
    }
    await this.run(async () => {
      await this.api.revoke(id);
      if (!this.alive) return;
      this.pendingSessionRevocation.set("");
      this.message.set(
        "Sesión revocada. Si era la actual, deberás volver a entrar.",
      );
      await this.loadSessions();
    });
  }
  cancelSessionRevocation(id: string): void {
    if (!this.busy() && this.pendingSessionRevocation() === id) this.pendingSessionRevocation.set("");
  }
  async setupMfa(): Promise<void> {
    if (!this.mfa() || this.mfa()!.enabled || this.tab() !== "Seguridad") return;
    const version = this.securityVersion;
    await this.run(async () => {
      const result = await this.api.setupMfa(this.password);
      if (!this.alive || version !== this.securityVersion || this.tab() !== "Seguridad") return;
      this.setupUri.set(result.otpauthUri);
      clearInterval(this.setupTimer);
      this.setupSeconds.set(result.expiresInSeconds);
      const expiresAt = Date.now() + result.expiresInSeconds * 1000;
      this.setupTimer = setInterval(() => {
        const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
        this.setupSeconds.set(Math.max(remaining, 0));
        if (remaining <= 0) {
          clearInterval(this.setupTimer);
          this.setupTimer = undefined;
          this.setupUri.set('');
          this.factor = '';
          this.password = '';
          this.message.set('El alta de 2FA venció. Vuelve a prepararla para continuar.');
        }
      }, 1000);
      this.message.set(
        `Alta preparada; vence en ${result.expiresInSeconds} segundos.`,
      );
    }, false);
  }
  async enableMfa(): Promise<void> {
    if (!this.setupUri() || !/^\d{6}$/.test(this.factor.trim())) return;
    const version = this.securityVersion;
    await this.run(async () => {
      const result = await this.api.enableMfa({
        password: this.password,
        code: this.factor.trim(),
      });
      if (!this.alive) return;
      if (version === this.securityVersion && this.tab() === "Seguridad") this.recoveryCodes.set(result.recoveryCodes);
      this.setupUri.set("");
      clearInterval(this.setupTimer);
      this.setupTimer = undefined;
      this.setupSeconds.set(0);
      this.message.set("2FA activada. Guarda los códigos de recuperación antes de salir de Seguridad.");
      await this.refreshMfaStatus();
    });
  }
  async disableMfa(): Promise<void> {
    if (!this.mfa()?.enabled || !this.factorValid()) return;
    await this.run(async () => {
      await this.api.disableMfa({
        password: this.password,
        factor: this.factor.trim(),
      });
      if (!this.alive) return;
      this.recoveryCodes.set([]);
      this.message.set("2FA desactivada.");
      await this.refreshMfaStatus();
    });
  }
  async rotateCodes(): Promise<void> {
    if (!this.mfa()?.enabled || !this.factorValid()) return;
    const version = this.securityVersion;
    await this.run(async () => {
      const result = await this.api.rotateCodes({
        password: this.password,
        factor: this.factor.trim(),
      });
      if (!this.alive) return;
      if (version === this.securityVersion && this.tab() === "Seguridad") this.recoveryCodes.set(result.recoveryCodes);
      this.message.set("Códigos renovados. Los códigos anteriores ya no son válidos.");
      await this.refreshMfaStatus();
    });
  }
  factorValid(): boolean { return /^(\d{6}|[a-f0-9]{24})$/.test(this.factor.trim()); }
  async requestPrivacy(): Promise<void> {
    if (!this.mfa() || (this.mfa()!.enabled && !this.factorValid())) return;
    await this.run(async () => {
      await this.api.requestPrivacy({
        kind: this.privacyKind,
        password: this.password,
        ...(this.factor.trim() ? { factor: this.factor.trim() } : {}),
      });
      if (!this.alive) return;
      this.message.set(this.privacyKind === "deletion"
        ? "Solicitud de eliminación registrada. No confirma ni ejecuta una purga global; esa capacidad sigue pendiente."
        : "Solicitud de exportación registrada. La solicitud global sigue pendiente; puedes descargar aportes parciales cuando aparezca en la lista.");
      await this.loadPrivacy();
    });
  }
  async downloadPrivacyContribution(): Promise<void> {
    if (!this.alive || this.design || this.busy() || this.privacyContributionBusy() || this.privacyLoading()) return;
    const eligible = this.exportablePrivacyRequests();
    const selectedId = this.privacyExportRequestId();
    const requestId = eligible.find((item) => item.id === selectedId)?.id;
    if (!requestId || !this.mfa() || (this.mfa()!.enabled && !this.factorValid())) return;
    const scope = this.privacyExportScope();
    const manifest = this.privacyManifest();
    if (!manifest || manifest.requestId !== requestId || !this.availablePrivacyExportScopes().some((item) => privacyScopeKeys[item.scope] === scope)) {
      this.privacyContributionError.set("Consulta el manifiesto de esta solicitud y elige un alcance requerido que el servidor confirme como disponible.");
      return;
    }
    const keyId = `${requestId}:${scope}`;
    const key = this.privacyContributionKeys.get(keyId) ?? crypto.randomUUID();
    this.privacyContributionKeys.set(keyId, key);
    this.privacyContributionBusy.set(true);
    this.busy.set(true);
    this.privacyContributionError.set("");
    this.privacyContributionMessage.set("");
    try {
      const result = await this.api.privacyContribution(requestId, scope, {
        password: this.password,
        ...(this.factor.trim() ? { factor: this.factor.trim() } : {}),
      }, key);
      if (!this.alive) return;
      const expectedScope = privacyScopeContracts[scope];
      if (result.requestId !== requestId || result.state !== "prepared" || result.scope !== expectedScope || result.fulfillment !== "partial" || result.globalFulfillment !== "pending") {
        throw new Error("El servidor devolvió un alcance de privacidad inesperado. No se descargó ningún archivo.");
      }
      this.privacyContributionKeys.delete(keyId);
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `autoclipper-${scope}-${result.receiptId}.json`;
      anchor.hidden = true;
      try {
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        globalThis.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      this.privacyContributionMessage.set(`${privacyScopeNames[scope]} · aporte parcial descargado. La solicitud global sigue pendiente; este archivo no confirma una exportación completa ni una purga.`);
      await this.loadPrivacyManifest(requestId);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) this.privacyContributionKeys.delete(keyId);
      this.privacyContributionError.set(errorMessage(error));
      await this.loadPrivacyManifest(requestId);
    } finally {
      this.password = "";
      this.factor = "";
      this.privacyContributionBusy.set(false);
      this.busy.set(false);
    }
  }
  async loadPrivacy(): Promise<void> {
    if (this.design || !this.alive || this.privacyLoading()) return;
    this.privacyLoading.set(true);
    this.privacyError.set("");
    try {
      const result = await this.api.privacy();
      if (!this.alive) return;
      this.privacy.set(result.items);
      const exportable = this.exportablePrivacyRequests();
      const selectedId = exportable.some((item) => item.id === this.privacyExportRequestId())
        ? this.privacyExportRequestId()
        : exportable[0]?.id ?? "";
      this.privacyExportRequestId.set(selectedId);
      this.privacyLoaded.set(true);
      if (selectedId) await this.loadPrivacyManifest(selectedId);
      else {
        this.privacyManifestGeneration++;
        this.privacyManifest.set(null);
        this.privacyManifestError.set("");
      }
    } catch (error) {
      if (this.alive) this.privacyError.set(errorMessage(error));
    } finally {
      if (this.alive) this.privacyLoading.set(false);
    }
  }
  async refreshMfaStatus(): Promise<void> {
    if (this.design || !this.alive || this.mfaLoading()) return;
    this.mfaLoading.set(true);
    this.mfaError.set("");
    try {
      const result = await this.api.mfa();
      if (this.alive) this.mfa.set(result);
    } catch (error) {
      if (this.alive) { this.mfa.set(null); this.mfaError.set(errorMessage(error)); }
    } finally {
      if (this.alive) this.mfaLoading.set(false);
    }
  }
  private async run(
    action: () => Promise<void>,
    clearProof = true,
  ): Promise<void> {
    if (!this.alive || this.design || this.busy() || this.privacyContributionBusy()) return;
    this.busy.set(true);
    this.error.set("");
    this.message.set("");
    try {
      await action();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
      if (clearProof) {
        this.password = "";
        this.factor = "";
      }
    }
  }
}
