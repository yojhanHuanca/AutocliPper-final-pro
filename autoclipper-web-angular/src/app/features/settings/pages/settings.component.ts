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
    });
    if (!this.design) void this.load();
  }
  async load(): Promise<void> {
    await this.run(async () => {
      const [profile, mfa, privacy] = await Promise.all([
        this.api.profile(),
        this.api.mfa(),
        this.api.privacy(),
      ]);
      this.profile.set(profile);
      this.name = profile.name;
      this.timezone = profile.preferences.timezone;
      this.mfa.set(mfa);
      this.privacy.set(privacy.items);
      await this.loadSessions();
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
      const user = this.session.user();
      if (user) this.session.user.set({ ...user, name: result.name });
      this.message.set("Perfil actualizado.");
    });
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
