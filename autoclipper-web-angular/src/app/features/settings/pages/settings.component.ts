import { DESIGN_MODE } from "../../../core/config/design-mode.token";
import { SettingsApi } from "../data-access/settings-api.service";
import {
  ViewEncapsulation,
  Component,
  DestroyRef,
  inject,
  signal,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import type { Schema } from "../../../core/contracts/api-types";
import { SessionStore } from "../../../core/auth/session.store";
import { errorMessage } from "../../../core/http/api-error";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { isValidIanaTimezone } from '../models/timezone';

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-settings",
  imports: [FormsModule, DatePipe, IconComponent, RouterLink],
  templateUrl: "./settings.component.html",
  styleUrl: "./settings.component.css",
})
export class SettingsComponent {
  private readonly api = inject(SettingsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionStore);
  private readonly destroy = inject(DestroyRef);
  private setupTimer?: ReturnType<typeof setTimeout>;
  private alive = true;
  private securityVersion = 0;
  private sessionsVersion = 0;
  readonly setupSeconds = signal(0);
  readonly design = inject(DESIGN_MODE);
  readonly tabItems = ["Perfil", "Seguridad", "Privacidad"] as const;
  readonly tab = signal("Perfil");
  readonly profile = signal<Schema<"ProfileResponseDto"> | null>(null);
  readonly mfa = signal<Schema<"MfaStatusResponseDto"> | null>(null);
  readonly sessions = signal<Schema<"SessionResponseDto">[]>([]);
  readonly sessionsLoading = signal(false);
  readonly sessionsError = signal("");
  readonly privacy = signal<Schema<"PrivacyStatusResponseDto">[]>([]);
  readonly profileError = signal("");
  readonly mfaError = signal("");
  readonly privacyError = signal("");
  readonly privacyLoaded = signal(false);
  readonly privacyLoading = signal(false);
  readonly mfaLoading = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly message = signal("");
  readonly setupUri = signal("");
  readonly recoveryCodes = signal<string[]>([]);
  name = "";
  timezone = "America/Lima";
  emailNotifications = true;
  password = "";
  factor = "";
  privacyKind: "export" | "deletion" = "export";
  constructor() {
    this.destroy.onDestroy(() => {
      this.alive = false;
      this.securityVersion += 1;
      this.sessionsVersion += 1;
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
        this.emailNotifications = profile.preferences.emailNotifications;
      } else { this.profileError.set(errorMessage(results[0].reason)); failures.push(`${labels[0]}: ${this.profileError()}`); }
      if (results[1].status === 'fulfilled') this.mfa.set(results[1].value);
      else { this.mfa.set(null); this.mfaError.set(errorMessage(results[1].reason)); failures.push(`${labels[1]}: ${this.mfaError()}`); }
      if (results[2].status === 'fulfilled') { this.privacy.set(results[2].value.items); this.privacyLoaded.set(true); }
      else { this.privacyError.set(errorMessage(results[2].reason)); failures.push(`${labels[2]}: ${this.privacyError()}`); }
      if (results[3].status === 'fulfilled') this.sessions.set(results[3].value.items);
      else { this.sessionsError.set(errorMessage(results[3].reason)); failures.push(`${labels[3]}: ${errorMessage(results[3].reason)}`); }
      this.sessionsLoading.set(false);
      if (failures.length) this.error.set(`Algunos datos no se pudieron cargar. ${failures.join(' · ')}`);
    });
  }
  async saveProfile(): Promise<void> {
    await this.run(async () => {
      const profile = this.profile();
      if (!profile) return;
      const result = await this.api.saveProfile({
        version: profile.version,
        name: this.name.trim(),
        preferences: { timezone: this.timezone.trim(), emailNotifications: this.emailNotifications },
      } satisfies Schema<"UpdateProfileDto">);
      if (!this.alive || this.session.user()?.id !== profile.id) return;
      this.profile.set(result);
      this.name = result.name;
      this.timezone = result.preferences.timezone;
      this.emailNotifications = result.preferences.emailNotifications;
      const user = this.session.user();
      if (user) this.session.user.set({ ...user, name: result.name });
      this.message.set("Perfil actualizado.");
    });
  }
  timezoneValid(): boolean {
    return isValidIanaTimezone(this.timezone);
  }
  resetProfile(): void {
    const profile = this.profile();
    if (!profile) return;
    this.name = profile.name;
    this.timezone = profile.preferences.timezone;
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
    if (event.key === "ArrowRight") next = (index + 1) % this.tabItems.length;
    else if (event.key === "ArrowLeft")
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
    this.sessionsError.set('');
    try {
      const result = await this.api.sessions();
      if (this.alive && version === this.sessionsVersion) this.sessions.set(result.items);
    } catch (error) {
      if (this.alive && version === this.sessionsVersion) this.sessionsError.set(errorMessage(error));
    } finally {
      if (this.alive && version === this.sessionsVersion) this.sessionsLoading.set(false);
    }
  }
  privacyKindLabel(kind: Schema<'PrivacyStatusResponseDto'>['kind']): string {
    return kind === 'export' ? 'Exportación de datos' : 'Eliminación de datos';
  }
  privacyStateLabel(state: Schema<'PrivacyStatusResponseDto'>['state']): string {
    return ({ requested: 'Registrada · ejecución pendiente', processing: 'En proceso', completed: 'Completada', rejected: 'Rechazada' })[state];
  }
  async revoke(id: string): Promise<void> {
    await this.run(async () => {
      await this.api.revoke(id);
      this.message.set(
        "Sesión revocada. Si era la actual, deberás volver a entrar.",
      );
      await this.loadSessions();
    });
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
      this.message.set(
        "Solicitud registrada. La ejecución integral está pendiente.",
      );
      await this.loadPrivacy();
    });
  }
  async loadPrivacy(): Promise<void> {
    if (this.design || !this.alive || this.privacyLoading()) return;
    this.privacyLoading.set(true);
    this.privacyError.set("");
    try {
      const result = await this.api.privacy();
      if (!this.alive) return;
      this.privacy.set(result.items);
      this.privacyLoaded.set(true);
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
    if (!this.alive || this.design || this.busy()) return;
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
