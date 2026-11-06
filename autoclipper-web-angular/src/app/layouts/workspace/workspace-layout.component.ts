import { BrandComponent } from '../../shared/ui/brand/brand.component';
import { ApiTransport } from "../../core/http/api-transport.service";
import { DESIGN_MODE } from "../../core/config/design-mode.token";
import { WorkspaceStore } from "../../features/workspaces/data-access/workspace.store";
import { AppearancePreferenceService } from "../../core/preferences/appearance-preference.service";
import { ViewEncapsulation, Component, DestroyRef, ElementRef, inject, signal } from "@angular/core";
import {
  ActivatedRoute,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
  NavigationEnd,
} from "@angular/router";
import { SessionStore } from "../../core/auth/session.store";
import { errorMessage } from "../../core/http/api-error";
import { IconComponent } from "../../shared/ui/icon/icon.component";
import { workspaceRoleLabel } from "../../core/labels/workspace-role-label";
import type { Schema } from '../../core/contracts/api-types';
import { containTab, focusMain } from '../../core/a11y/navigation-focus';

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-shell",
  host: { '(keydown)': 'onNavigationKey($event)' },
  providers: [
    {
      provide: DESIGN_MODE,
      useFactory: () => inject(ActivatedRoute).snapshot.data["design"] === true,
    },
  ],
  imports: [BrandComponent, RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  templateUrl: "./workspace-layout.component.html",
  styleUrl: "./workspace-layout.component.css",
})
export class WorkspaceLayoutComponent {
  readonly workspace = inject(WorkspaceStore);
  private readonly appearance = inject(AppearancePreferenceService);

  readonly session = inject(SessionStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ApiTransport);
  private readonly destroy = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly mobileQuery = window.matchMedia("(max-width: 800px)");
  readonly mobile = signal(this.mobileQuery.matches);
  readonly design = this.route.snapshot.data["design"] === true;
  readonly base = this.design ? "/design" : "/app";
  readonly menuOpen = signal(false);
  readonly workspaceSwitching = signal(false);
  readonly gatewayState = signal<"checking" | "active" | "offline" | "unavailable">("checking");
  readonly error = signal("");
  private healthTimer?: ReturnType<typeof setInterval>;
  private healthRequest = false;
  private destroyed = false;
  constructor() {
    if (this.design) this.appearance.useDesignTheme();
    else {
      const userId = this.session.user()?.id;
      if (userId) this.appearance.restoreForUser(userId);
    }
    const resize = () => { this.mobile.set(this.mobileQuery.matches); this.menuOpen.set(false); };
    this.mobileQuery.addEventListener("change", resize);
    const navigation = this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd && this.menuOpen()) this.closeNavigation(false);
    });
    this.destroy.onDestroy(() => { this.destroyed = true; this.mobileQuery.removeEventListener("change", resize); navigation.unsubscribe(); });
    if (!this.design) {
      const check = () => void this.checkGateway();
      const onVisible = () => { if (document.visibilityState === "visible") check(); };
      window.addEventListener("online", check);
      window.addEventListener("offline", check);
      window.addEventListener("focus", check);
      document.addEventListener("visibilitychange", onVisible);
      this.healthTimer = setInterval(() => { if (document.visibilityState === "visible") check(); }, 60_000);
      this.destroy.onDestroy(() => {
        this.destroyed = true;
        clearInterval(this.healthTimer);
        window.removeEventListener("online", check);
        window.removeEventListener("offline", check);
        window.removeEventListener("focus", check);
        document.removeEventListener("visibilitychange", onVisible);
      });
      check();
    }
  }
  openNavigation(): void {
    if (this.menuOpen()) { this.closeNavigation(); return; }
    this.menuOpen.set(true);
    requestAnimationFrame(() => this.host.nativeElement.querySelector<HTMLElement>(".workspace-menu-close")?.focus());
  }
  closeNavigation(restoreButton = true): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    requestAnimationFrame(() => {
      if (this.destroyed) return;
      if (restoreButton) this.host.nativeElement.querySelector<HTMLElement>(".mobile-menu")?.focus();
      else focusMain(document);
    });
  }
  onNavigationKey(event: KeyboardEvent): void {
    if (!this.mobile() || !this.menuOpen()) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.closeNavigation(); return; }
    const sidebar = this.host.nativeElement.querySelector<HTMLElement>(".sidebar");
    if (sidebar) containTab(event, sidebar, document.activeElement);
  }
  onSidebarClick(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest("a[href]")) this.closeNavigation(false);
  }
  private async checkGateway(): Promise<void> {
    if (this.destroyed || this.healthRequest) return;
    if (!navigator.onLine) { this.gatewayState.set("offline"); return; }
    this.healthRequest = true;
    this.gatewayState.set("checking");
    try { await this.api.getPublic("/health/live"); if (!this.destroyed) this.gatewayState.set("active"); }
    catch { if (!this.destroyed) this.gatewayState.set("unavailable"); }
    finally { this.healthRequest = false; }
  }
  gatewayLabel(): string {
    return ({ checking: "Comprobando gateway API…", active: "Gateway API activo", offline: "Sin conexión de red", unavailable: "Gateway API no responde" } as const)[this.gatewayState()];
  }
  currentRole(): string {
    const role = this.workspace.workspaces().find((w) => w.id === this.workspace.workspaceId())?.role;
    return role ? workspaceRoleLabel(role) : "Cuenta";
  }
  workspaceOptionLabel(workspace: Schema<'WorkspaceSummaryDto'>): string {
    const kind = ({ personal: 'Personal', team: 'Equipo' } as Record<string, string>)[workspace.kind] ?? 'Espacio';
    return `${kind} · ${workspace.name} · ${workspaceRoleLabel(workspace.role)}`;
  }
  async selectWorkspace(id: string): Promise<void> {
    if (this.design || this.workspaceSwitching() || !this.workspace.workspaces().some((item) => item.id === id)) return;
    this.error.set("");
    const previous = this.workspace.workspaceId();
    if (id === previous) return;
    const path = this.router.url.split(/[?#]/, 1)[0];
    const currentPageIsProjectScoped = /^\/app\/(?:projects\/[^/]+|edits(?:\/[^/]+)?)\/?$/.test(path);
    this.workspace.workspaceId.set(id);
    if (!currentPageIsProjectScoped) return;
    this.workspaceSwitching.set(true);
    try {
      const navigated = await this.router.navigateByUrl('/app/projects');
      if (!navigated && this.workspace.workspaceId() === id) {
        this.workspace.workspaceId.set(previous);
        this.error.set('No pudimos abrir los proyectos del nuevo espacio. Se conserva el espacio anterior; selecciona otra vez el destino para reintentar.');
      }
    } catch (error) {
      if (this.workspace.workspaceId() === id) this.workspace.workspaceId.set(previous);
      this.error.set(`No pudimos abrir los proyectos del nuevo espacio: ${errorMessage(error)}`);
    } finally {
      this.workspaceSwitching.set(false);
    }
  }
  currentWorkspaceName(): string {
    if (this.design) return 'Exploración de diseño';
    return this.workspace.workspaces().find((item) => item.id === this.workspace.workspaceId())?.name ?? 'Mi espacio';
  }
  currentRouteLabel(): string {
    const path = this.router.url.split(/[?#]/, 1)[0].replace(/\/$/, '');
    if (path === this.base) return 'Inicio';
    if (path.startsWith(`${this.base}/projects/`)) return 'Proyecto';
    if (path === `${this.base}/projects`) return 'Proyectos';
    if (path.startsWith(`${this.base}/edits/`) || path === `${this.base}/editor`) return 'Editor de clip';
    if (path === `${this.base}/edits`) return 'Editor';
    if (path === `${this.base}/team`) return 'Equipo y espacio';
    if (path === `${this.base}/settings`) return 'Configuración';
    if (!this.design && path === '/app/consumption') return 'Consumo';
    return 'Estudio';
  }
  isProjectArea(): boolean {
    const path = this.router.url.split(/[?#]/, 1)[0];
    return path === `${this.base}/projects` || path.startsWith(`${this.base}/projects/`) || path === `${this.base}/editor` || path.startsWith(`${this.base}/editor/`) || (!this.design && (path === '/app/edits' || path.startsWith('/app/edits/')));
  }
  isEditorRoute(): boolean {
    const path = this.router.url.split(/[?#]/, 1)[0].replace(/\/$/, '');
    return this.design
      ? path === '/design/editor' || path.startsWith('/design/editor/')
      : path === '/app/edits' || path.startsWith('/app/edits/') || path === '/app/editor' || path.startsWith('/app/editor/');
  }
  async logout(): Promise<void> {
    try {
      await this.session.logout();
      this.workspace.clear();
      await this.router.navigateByUrl("/login");
    } catch (error) {
      this.error.set(errorMessage(error));
    }
  }
}
