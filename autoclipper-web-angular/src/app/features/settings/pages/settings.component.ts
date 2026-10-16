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
import { ActivatedRoute } from "@angular/router";
import type { Schema } from "../../../core/contracts/api-types";
import { SessionStore } from "../../../core/auth/session.store";
import { errorMessage } from "../../../core/http/api-error";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { isValidIanaTimezone } from '../models/timezone';

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-settings",
  imports: [FormsModule, DatePipe, IconComponent],
  templateUrl: "./settings.component.html",
  styleUrl: "./settings.component.css",
})
export class SettingsComponent {
  private readonly api = inject(SettingsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionStore);
  private readonly destroy = inject(DestroyRef);
  private setupTimer?: ReturnType<typeof setTimeout>;
  readonly setupSeconds = signal(0);
  readonly design = inject(DESIGN_MODE);
  readonly tab = signal("Perfil");
  readonly profile = signal<Schema<"ProfileResponseDto"> | null>(null);
  readonly mfa = signal<Schema<"MfaStatusResponseDto"> | null>(null);
  readonly sessions = signal<Schema<"SessionResponseDto">[]>([]);
  readonly privacy = signal<Schema<"PrivacyStatusResponseDto">[]>([]);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly message = signal("");
  readonly setupUri = signal("");
  readonly recoveryCodes = signal<string[]>([]);
  name = "";
  timezone = "America/Lima";
  password = "";
  factor = "";
  privacyKind: "export" | "deletion" = "export";
  constructor() {
    this.destroy.onDestroy(() => {
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
      const results = await Promise.allSettled([
        this.api.profile(),
        this.api.mfa(),
        this.api.privacy(),
        this.api.sessions(),
      ]);
      const labels = ['perfil', 'autenticación en dos pasos', 'privacidad', 'sesiones'];
      const failures: string[] = [];
      if (results[0].status === 'fulfilled') {
        const profile = results[0].value;
        this.profile.set(profile);
        this.name = profile.name;
        this.timezone = profile.preferences.timezone;
      } else failures.push(`${labels[0]}: ${errorMessage(results[0].reason)}`);
      if (results[1].status === 'fulfilled') this.mfa.set(results[1].value);
      else failures.push(`${labels[1]}: ${errorMessage(results[1].reason)}`);
      if (results[2].status === 'fulfilled') this.privacy.set(results[2].value.items);
      else failures.push(`${labels[2]}: ${errorMessage(results[2].reason)}`);
      if (results[3].status === 'fulfilled') this.sessions.set(results[3].value.items);
      else failures.push(`${labels[3]}: ${errorMessage(results[3].reason)}`);
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
        preferences: { timezone: this.timezone.trim() },
      } satisfies Schema<"UpdateProfileDto">);
      this.profile.set(result);
      this.name = result.name;
      this.timezone = result.preferences.timezone;
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
    this.error.set('');
    this.message.set('Cambios descartados.');
  }
  selectTab(tab: string): void {
    if (tab !== 'Seguridad') this.clearSensitive();
    this.tab.set(tab);
  }
  hideSetup(): void { this.clearSensitive(); }
  private clearSensitive(): void {
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
    try {
      this.sessions.set((await this.api.sessions()).items);
    } catch (error) {
      this.error.set(errorMessage(error));
    }
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
    await this.run(async () => {
      const result = await this.api.setupMfa(this.password);
      this.setupUri.set(result.otpauthUri);
      clearInterval(this.setupTimer);
      this.setupSeconds.set(result.expiresInSeconds);
      this.setupTimer = setInterval(() => {
        const remaining = this.setupSeconds() - 1;
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
    await this.run(async () => {
      const result = await this.api.enableMfa({
        password: this.password,
        code: this.factor.trim(),
      });
      this.recoveryCodes.set(result.recoveryCodes);
      this.setupUri.set("");
      clearInterval(this.setupTimer);
      this.setupTimer = undefined;
      this.setupSeconds.set(0);
      this.mfa.set(await this.api.mfa());
      this.message.set("2FA activada. Guarda los códigos de recuperación.");
    });
  }
  async disableMfa(): Promise<void> {
    await this.run(async () => {
      await this.api.disableMfa({
        password: this.password,
        factor: this.factor.trim(),
      });
      this.recoveryCodes.set([]);
      this.mfa.set(await this.api.mfa());
      this.message.set("2FA desactivada.");
    });
  }
  async rotateCodes(): Promise<void> {
    await this.run(async () => {
      const result = await this.api.rotateCodes({
        password: this.password,
        factor: this.factor.trim(),
      });
      this.recoveryCodes.set(result.recoveryCodes);
      this.mfa.set(await this.api.mfa());
    });
  }
  async requestPrivacy(): Promise<void> {
    await this.run(async () => {
      await this.api.requestPrivacy({
        kind: this.privacyKind,
        password: this.password,
        ...(this.factor.trim() ? { factor: this.factor.trim() } : {}),
      });
      this.privacy.set((await this.api.privacy()).items);
      this.message.set(
        "Solicitud registrada. La ejecución integral está pendiente.",
      );
    });
  }
  private async run(
    action: () => Promise<void>,
    clearProof = true,
  ): Promise<void> {
    if (this.design || this.busy()) return;
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
