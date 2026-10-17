import { AuthApi } from "../data-access/auth-api.service";
import { ViewEncapsulation, Component, DestroyRef, computed, effect, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { SessionStore } from "../../../core/auth/session.store";
import { errorMessage } from "../../../core/http/api-error";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { BrandComponent } from "../../../shared/ui/brand/brand.component";
import { AUTH_STORY_ACCENTS, AUTH_STORY_SCENES, createAuthStoryCycle } from "./auth-story";

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-auth",
  imports: [FormsModule, RouterLink, IconComponent, BrandComponent],
  host: {
    "[class.motion-paused]": "motionPaused() || reducedMotion()",
    "[style.--auth-accent]": "accent()",
    "[style.--auth-accent-soft]": "accentSoft()",
  },
  templateUrl: "./auth.component.html",
  styleUrl: "./auth.component.css",
})
export class AuthComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(AuthApi);
  private readonly session = inject(SessionStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly message = signal("");
  readonly motionPaused = signal(false);
  readonly reducedMotion = signal(false);
  readonly stepIndex = signal(0);
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
    effect(() => cycle.configure(this.motionPaused(), this.reducedMotion()));
    this.destroyRef.onDestroy(() => {
      motionPreference.removeEventListener("change", updateMotionPreference);
      cycle.destroy();
    });
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (this.token) void this.router.navigate([], { relativeTo: this.route, queryParams: { token: null }, queryParamsHandling: 'merge', replaceUrl: true });
    if (this.route.snapshot.queryParamMap.get('connection') === 'unavailable') this.error.set('No pudimos consultar tu espacio. Revisa la conexión con el servidor y vuelve a entrar.');
  }
  get mode(): string {
    return this.route.snapshot.data["mode"] as string;
  }
  get title(): string {
    return (
      {
        login: "Qué bueno verte.",
        register: "Dale otra vida a tus ideas.",
        verify: "Confirma tu correo.",
        forgot: "Volvamos a conectar.",
        reset: "Un nuevo comienzo.",
      } as Record<string, string>
    )[this.mode];
  }
  get description(): string {
    return this.mode === "login"
      ? "Entra y continúa donde dejaste tu historia."
      : this.mode === "register"
        ? "Crea tu cuenta para empezar con tu propio material."
        : "Usa el correo y el token de tu cuenta en este entorno.";
  }
  get action(): string {
    return (
      {
        login: "Entrar al estudio",
        register: "Crear cuenta",
        verify: "Verificar correo",
        forgot: "Solicitar recuperación",
        reset: "Guardar contraseña",
      } as Record<string, string>
    )[this.mode];
  }
  async submit(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    this.message.set("");
    try {
      if (this.mode === "login") {
        await this.session.login({
          email: this.email.trim(),
          password: this.password,
          ...(this.factor.trim() ? { factor: this.factor.trim() } : {}),
        });
        const requested = this.route.snapshot.queryParamMap.get("returnUrl");
        await this.router.navigateByUrl(
          requested?.startsWith("/app") && !requested.startsWith("//")
            ? requested
            : "/app",
        );
      } else if (this.mode === "register") {
        await this.api.register({
          name: this.name.trim(),
          email: this.email.trim(),
          password: this.password,
        });
        this.message.set(
          "Solicitud recibida. Revisa tu correo para verificar la cuenta antes de entrar.",
        );
      } else if (this.mode === "verify") {
        await this.api.verify(this.token.trim());
        this.message.set("Correo verificado. Ya puedes iniciar sesión.");
      } else if (this.mode === "forgot") {
        await this.api.forgot(this.email.trim());
        this.message.set(
          "Si la cuenta corresponde, recibirás las instrucciones por correo.",
        );
      } else {
        await this.api.reset({
          token: this.token.trim(),
          password: this.password,
        });
        this.message.set("Contraseña actualizada. Inicia sesión de nuevo.");
      }
      this.password = "";
      this.factor = "";
      this.token = "";
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
