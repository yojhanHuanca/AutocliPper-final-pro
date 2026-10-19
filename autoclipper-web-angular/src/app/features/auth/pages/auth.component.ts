import { AuthApi } from "../data-access/auth-api.service";
import { ViewEncapsulation, Component, DestroyRef, computed, effect, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { HttpErrorResponse } from "@angular/common/http";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { SessionStore } from "../../../core/auth/session.store";
import { errorMessage } from "../../../core/http/api-error";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { AUTH_STORY_ACCENTS, AUTH_STORY_SCENES, createAuthStoryCycle } from "./auth-story";
import { WorkspaceStore } from "../../workspaces/data-access/workspace.store";
import { buildLoginPayload } from "../models/login-payload";
import { safeAuthReturnUrl } from "../models/auth-return-url";

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-auth",
  imports: [FormsModule, RouterLink, IconComponent],
  host: {
    "[class.motion-paused]": "reducedMotion()",
    "[style.--auth-accent]": "accent()",
    "[style.--auth-accent-soft]": "accentSoft()",
  },
  templateUrl: "./auth.component.html",
  styleUrl: "./auth.component.css",
})
export class AuthComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(AuthApi);
  readonly session = inject(SessionStore);
  private readonly workspaces = inject(WorkspaceStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly message = signal("");
  readonly reducedMotion = signal(false);
  readonly stepIndex = signal(0);
  readonly invitationReady = signal(false);
  readonly invitationChecking = signal(false);
  readonly registerAccepted = signal(false);
  readonly authCompleted = signal(false);
  readonly registeredEmail = signal("");
  readonly showPassword = signal(false);
  readonly showPasswordConfirmation = signal(false);
  readonly accent = computed(() => AUTH_STORY_ACCENTS[this.stepIndex() % AUTH_STORY_ACCENTS.length]);
  readonly accentSoft = computed(() => `${this.accent()}24`);
  readonly activeScene = computed(() => this.scenes[this.stepIndex()]);
  readonly timelineProgress = computed(() => [9, 28, 49, 72, 96][this.stepIndex()]);
  readonly scenes = AUTH_STORY_SCENES;
  readonly waveformBars = Array.from(
    { length: 52 },
    (_, index) => 18 + (Math.sin(index * 1.55) + 1) * 34,
  );
  name = "";
  email = "";
  password = "";
  passwordConfirmation = "";
  factor = "";
  token = "";
  constructor() {
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion.set(motionPreference.matches);
    const updateMotionPreference = () => {
      this.reducedMotion.set(motionPreference.matches);
      if (motionPreference.matches) this.stepIndex.set(0);
    };
    motionPreference.addEventListener("change", updateMotionPreference);
    const cycle = createAuthStoryCycle(() => this.stepIndex(), (index) => this.stepIndex.set(index), (tick, milliseconds) => {
      const timer = window.setInterval(tick, milliseconds);
      return () => window.clearInterval(timer);
    });
    effect(() => cycle.configure(false, this.reducedMotion()));
    this.destroyRef.onDestroy(() => {
      motionPreference.removeEventListener("change", updateMotionPreference);
      cycle.destroy();
      this.password = "";
      this.passwordConfirmation = "";
      this.factor = "";
      this.token = "";
    });
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (this.token) void this.router.navigate([], { relativeTo: this.route, queryParams: { token: null }, queryParamsHandling: 'merge', replaceUrl: true });
    if (this.route.snapshot.queryParamMap.get('connection') === 'unavailable') this.error.set('No pudimos consultar tu espacio. Revisa la conexión con el servidor y vuelve a entrar.');
    if (this.mode === "invitation") {
      this.invitationChecking.set(true);
      void this.session.restore().catch((error) => this.error.set(errorMessage(error))).finally(() => {
        this.invitationChecking.set(false);
        this.invitationReady.set(true);
      });
      this.destroyRef.onDestroy(() => { this.token = ""; });
    }
  }
  get mode(): string {
    return this.route.snapshot.data["mode"] as string;
  }
  get title(): string {
    return (
      {
        login: "Qué bueno verte.",
        invitation: "Te invitaron a un equipo.",
        register: "Dale otra vida a tus ideas.",
        verify: "Confirma tu correo.",
        forgot: "Recupera tu acceso.",
        reset: "Un nuevo comienzo.",
      } as Record<string, string>
    )[this.mode];
  }
  get description(): string {
    return this.mode === "invitation"
      ? "Entra con el correo al que llegó la invitación y confirma el acceso al espacio."
      : this.mode === "login"
      ? "Entra y continúa donde dejaste tu historia."
      : this.mode === "register"
        ? "Crea tu cuenta para empezar con tu propio material."
        : this.mode === "verify"
          ? "Pega el token del correo para verificar tu cuenta."
          : this.mode === "forgot"
            ? "Escribe tu correo y te enviaremos instrucciones si la cuenta corresponde."
            : this.mode === "reset"
              ? "Usa el token del correo para guardar una contraseña nueva."
              : "Entra con el correo que recibió la invitación.";
  }
  get action(): string {
    return (
      {
        login: "Entrar al estudio",
        invitation: this.session.user() ? "Aceptar invitación" : "Entrar para revisar invitación",
        register: "Crear cuenta",
        verify: "Verificar correo",
        forgot: "Solicitar recuperación",
        reset: "Guardar contraseña",
      } as Record<string, string>
    )[this.mode];
  }
  maskedRegistrationEmail(): string {
    const email = this.registeredEmail();
    const at = email.lastIndexOf("@");
    if (at < 1) return email;
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    const dot = domain.lastIndexOf(".");
    const host = dot > 0 ? domain.slice(0, dot) : domain;
    const suffix = dot > 0 ? domain.slice(dot) : "";
    return `${local.slice(0, 1)}•••@${host.slice(0, 1)}•••${suffix}`;
  }
  registrationValid(): boolean {
    return this.name.trim().length > 0 && this.name.trim().length <= 100 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim()) &&
      this.password.length >= 12 && this.password.length <= 128 &&
      this.passwordConfirmation.length > 0 && this.password === this.passwordConfirmation;
  }
  completionTitle(): string {
    return ({ verify: "Correo verificado", forgot: "Solicitud recibida", reset: "Contraseña actualizada" } as Record<string, string>)[this.mode] ?? "Listo";
  }
  clearError(): void {
    this.error.set("");
  }
  registrationPasswordFeedback(): string {
    if (!this.password) return "Contraseña de 12–128 caracteres.";
    if (this.password.length < 12) return `Añade ${12 - this.password.length}; el rango es 12–128.`;
    if (this.password.length > 128) return "Máximo 128; el rango es 12–128.";
    return "Longitud válida; el rango es 12–128.";
  }
  async changeInvitationAccount(): Promise<void> {
    this.error.set("");
    try {
      await this.session.logout();
      this.email = "";
      this.factor = "";
      this.message.set("");
    } catch (error) {
      this.error.set(errorMessage(error));
    }
  }
  async submit(): Promise<void> {
    if (this.busy() || this.authCompleted() || (this.mode === "register" && this.registerAccepted())) return;
    if (this.mode === "register" && !this.registerAccepted() && !this.registrationValid()) {
      this.error.set("Revisa los campos señalados antes de continuar.");
      return;
    }
    if (this.mode === "register" && this.registerAccepted()) return;
    this.busy.set(true);
    this.error.set("");
    this.message.set("");
    try {
      if (this.mode === "invitation") {
        if (!this.token) throw new Error("El enlace de invitación no contiene un token válido. Pide a quien te invitó que envíe uno nuevo.");
        if (!this.session.user()) {
          await this.session.login(buildLoginPayload(this.email, this.password, this.factor));
          this.password = "";
          this.factor = "";
          this.message.set("Sesión iniciada. Revisa que esta sea la cuenta que recibió el correo y pulsa «Aceptar invitación» para confirmar.");
          return;
        }
        await this.workspaces.acceptInvitation(this.token);
        this.token = "";
        this.message.set("Invitación aceptada. Ya tienes acceso al espacio.");
        await this.router.navigateByUrl("/app");
      } else if (this.mode === "login") {
        await this.session.login(buildLoginPayload(this.email, this.password, this.factor));
        this.password = "";
        this.factor = "";
        await this.router.navigateByUrl(safeAuthReturnUrl(this.route.snapshot.queryParamMap.get("returnUrl")));
      } else if (this.mode === "register") {
        const result = await this.api.register({
          name: this.name.trim(),
          email: this.email.trim(),
          password: this.password,
        });
        if (result?.accepted !== true) throw new Error("No se pudo completar la solicitud.");
        this.registeredEmail.set(this.email.trim());
        this.registerAccepted.set(true);
        this.message.set("");
        this.password = "";
        this.passwordConfirmation = "";
      } else if (this.mode === "verify") {
        await this.api.verify(this.token.trim());
        this.message.set("Correo verificado. Ya puedes iniciar sesión.");
        this.authCompleted.set(true);
      } else if (this.mode === "forgot") {
        await this.api.forgot(this.email.trim());
        this.message.set(
          "Si la cuenta corresponde, recibirás las instrucciones por correo.",
        );
        this.authCompleted.set(true);
      } else {
        await this.api.reset({
          token: this.token.trim(),
          password: this.password,
        });
        this.message.set("Contraseña actualizada. Inicia sesión de nuevo.");
        this.authCompleted.set(true);
      }
      this.password = "";
      this.factor = "";
      this.token = "";
    } catch (error) {
      this.error.set(this.authError(error));
    } finally {
      this.busy.set(false);
    }
  }
  private authError(error: unknown): string {
    const status = error instanceof HttpErrorResponse ? error.status : null;
    if (status === 429) return "Demasiados intentos seguidos. Espera un momento y vuelve a probar.";
    if (this.mode === "register") {
      return status === 0
        ? "No pudimos confirmar la solicitud por un problema de conexión. Puedes intentarlo de nuevo; por privacidad, no confirmamos si existe una cuenta asociada al correo."
        : "No pudimos completar la solicitud. Revisa los datos e inténtalo más tarde. Por privacidad, no confirmamos si existe una cuenta asociada al correo.";
    }
    if (status === 0) return "No pudimos conectar con el servidor. Revisa la conexión y vuelve a intentarlo.";
    if (status !== null && status >= 500) return this.mode === "forgot"
      ? "El servicio de acceso no está disponible ahora. Inténtalo más tarde; por privacidad, no confirmamos cuentas."
      : "El servicio de acceso no está disponible ahora. Inténtalo más tarde.";
    if (this.mode === "forgot") return "No pudimos completar la solicitud. Si la cuenta corresponde, las instrucciones llegarán por correo; por privacidad no confirmamos cuentas.";
    if (this.mode === "verify") return "No pudimos verificar este token. Puede haber vencido o no corresponder; revisa que hayas pegado el token completo del correo. Esta pantalla no puede reenviar la verificación.";
    if (this.mode === "reset") return "No pudimos cambiar la contraseña. Revisa que el enlace siga vigente y que la contraseña cumpla los requisitos.";
    return errorMessage(error);
  }
}
