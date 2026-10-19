import { DatePipe } from "@angular/common";
import { Component, DestroyRef, ViewEncapsulation, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { errorMessage } from "../../../core/http/api-error";
import type { Schema } from "../../../core/contracts/api-types";
import { BrandComponent } from "../../../shared/ui/brand/brand.component";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { AdminApi } from "../data-access/admin-api.service";

type AdminSection = "users" | "workspaces" | "jobs" | "consumption";
type AdminView = "summary" | AdminSection;
type AdminPermission = Schema<"AdminAccessDto">["permissions"][number];

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-admin-console",
  imports: [DatePipe, FormsModule, RouterLink, BrandComponent, IconComponent],
  templateUrl: "./admin-console.component.html",
  styleUrl: "./admin-console.component.css",
})
export class AdminConsoleComponent {
  private readonly api = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);
  readonly access = signal<Schema<"AdminAccessDto"> | null>(null);
  readonly notFound = signal(false);
  readonly loadingAccess = signal(true);
  readonly elevatedUntil = signal("");
  readonly now = signal(Date.now());
  readonly isElevated = computed(() => {
    const current = this.access();
    return !!current?.granted && current.mfaEnabled && !!current.elevatedUntil && Date.parse(current.elevatedUntil) > this.now();
  });
  readonly sections = [
    { id: "users", permission: "users.read", label: "Usuarios", icon: "users" },
    { id: "workspaces", permission: "workspaces.read", label: "Espacios", icon: "folder" },
    { id: "jobs", permission: "jobs.read", label: "Procesamiento", icon: "film" },
    { id: "consumption", permission: "consumption.read", label: "Consumo", icon: "chart" },
  ] as const satisfies ReadonlyArray<{ id: AdminSection; permission: AdminPermission; label: string; icon: string }>;
  readonly availableSections = computed(() => this.sections.filter((item) => this.access()?.permissions.includes(item.permission)));
  readonly activeView = signal<AdminView>("summary");
  readonly section = signal<AdminSection | null>(null);
  readonly users = signal<Schema<"AdminUserDto">[]>([]);
  readonly workspaces = signal<Schema<"AdminWorkspaceDto">[]>([]);
  readonly jobs = signal<Schema<"AdminJobDto">[]>([]);
  readonly consumption = signal<Schema<"AdminConsumptionDto">[]>([]);
  readonly nextBeforeId = signal<string | null>(null);
  readonly loadingPage = signal(false);
  readonly pageFailed = signal(false);
  readonly error = signal("");
  readonly message = signal("");
  readonly mutationBusy = signal(false);
  readonly workspaceFilter = signal("");
  readonly localSearch = signal("");
  readonly jobKindFilter = signal("");
  readonly jobStatusFilter = signal("");
  password = "";
  factor = "";
  private accessVersion = 0;
  private pageVersion = 0;

  constructor() {
    const clock = setInterval(() => {
      this.now.set(Date.now());
      if (!this.isElevated()) {
        this.clearData();
        this.message.set("");
      }
    }, 1_000);
    this.destroyRef.onDestroy(() => {
      clearInterval(clock);
      this.pageVersion += 1;
      this.accessVersion += 1;
      this.password = "";
      this.factor = "";
    });
    void this.refreshAccess();
  }

  canRead(permission: AdminPermission): boolean {
    return !!this.access()?.permissions.includes(permission);
  }
  get scopeLabel(): string {
    const ids = this.access()?.workspaceIds;
    if (ids === null) return "Alcance global explícito";
    if (!ids?.length) return "Sin workspaces autorizados";
    return `${ids.length} espacio${ids.length === 1 ? " autorizado" : "s autorizados"}`;
  }
  get activeSectionLabel(): string {
    return this.sections.find((item) => item.id === this.section())?.label ?? "";
  }
  async refreshAccess(): Promise<void> {
    const version = ++this.accessVersion;
    const previous = this.access();
    this.clearData();
    this.access.set(null);
    this.activeView.set("summary");
    this.message.set("");
    this.loadingAccess.set(true);
    this.error.set("");
    this.notFound.set(false);
    try {
      const result = await this.api.access();
      if (version !== this.accessVersion) return;
      const authorityChanged = !!previous && this.authorityChanged(previous, result);
      if (authorityChanged) this.clearData();
      this.access.set(result);
      this.now.set(Date.now());
      this.elevatedUntil.set(result.elevatedUntil ?? "");
      if (!result.granted || !result.mfaEnabled || !result.elevatedUntil || Date.parse(result.elevatedUntil) <= Date.now()) {
        this.clearData();
        this.section.set(null);
      } else if (authorityChanged) {
        if (this.workspaceFilter() && result.workspaceIds !== null && !result.workspaceIds.includes(this.workspaceFilter())) this.workspaceFilter.set("");
        if (!this.section() || !result.permissions.includes(`${this.section()}.read` as AdminPermission)) {
          this.section.set(this.sections.find((item) => result.permissions.includes(item.permission))?.id ?? null);
        }
        if (this.section()) await this.loadSection();
      } else if (!this.section() || !result.permissions.includes(`${this.section()}.read` as AdminPermission)) {
        this.clearData();
        this.section.set(this.sections.find((item) => result.permissions.includes(item.permission))?.id ?? null);
        if (this.sections.some((item) => result.permissions.includes(item.permission))) await this.loadSection();
      } else {
        await this.loadSection();
      }
    } catch (error) {
      if (version !== this.accessVersion) return;
      this.access.set(null);
      this.clearData();
      this.notFound.set(this.httpStatus(error) === 404);
      this.error.set(this.notFound() ? "" : this.adminError(error));
    } finally {
      if (version === this.accessVersion) this.loadingAccess.set(false);
    }
  }
  async elevate(): Promise<void> {
    if (this.loadingAccess() || this.mutationBusy() || !this.access()?.granted || !this.access()?.mfaEnabled || !this.password || !/^(\d{6}|[a-f0-9]{24})$/.test(this.factor.trim())) return;
    const version = this.accessVersion;
    this.mutationBusy.set(true);
    this.error.set("");
    this.message.set("");
    try {
      const result = await this.api.elevate({ password: this.password, factor: this.factor.trim() });
      if (version !== this.accessVersion) return;
      this.elevatedUntil.set(result.elevatedUntil);
      this.access.update((current) => current ? { ...current, elevatedUntil: result.elevatedUntil } : current);
      this.password = "";
      this.factor = "";
      this.now.set(Date.now());
      this.message.set("Acceso de consulta elevado por cinco minutos para esta sesión.");
      this.section.set(this.availableSections()[0]?.id ?? null);
      if (this.availableSections().length) await this.loadSection();
    } catch (error) {
      if (version === this.accessVersion) this.error.set(this.adminError(error));
    } finally {
      this.mutationBusy.set(false);
      this.password = "";
      this.factor = "";
    }
  }
  async selectSection(section: AdminSection): Promise<void> {
    if (!this.availableSections().some((item) => item.id === section) || !this.isElevated()) return;
    this.section.set(section);
    this.activeView.set(section);
    this.clearData();
    await this.loadSection();
  }
  showSummary(): void {
    if (this.isElevated()) this.activeView.set("summary");
  }
  visibleUsers(): Schema<"AdminUserDto">[] {
    const query = this.localSearch().trim().toLowerCase();
    return this.users().filter((user) => !query || [user.id, user.verified ? "verificada" : "sin verificar", user.mfaEnabled ? "mfa activo" : "sin mfa", user.createdAt].join(" ").toLowerCase().includes(query));
  }
  visibleWorkspaces(): Schema<"AdminWorkspaceDto">[] {
    const query = this.localSearch().trim().toLowerCase();
    return this.workspaces().filter((item) => !query || [item.id, item.kind, item.memberCount, item.createdAt].join(" ").toLowerCase().includes(query));
  }
  visibleJobs(): Schema<"AdminJobDto">[] {
    const query = this.localSearch().trim().toLowerCase();
    return this.jobs().filter((job) => (!query || [job.id, job.workspaceId, job.kind, job.status, job.errorCode, job.createdAt, job.finishedAt].join(" ").toLowerCase().includes(query)) && (!this.jobKindFilter() || job.kind === this.jobKindFilter()) && (!this.jobStatusFilter() || job.status === this.jobStatusFilter()));
  }
  visibleConsumption(): Schema<"AdminConsumptionDto">[] {
    const query = this.localSearch().trim().toLowerCase();
    return this.consumption().filter((item) => !query || [item.id, item.planVersion, item.unit, item.periodStart, item.periodEnd, item.budgetSeconds, item.consumedSeconds, item.reservedSeconds].join(" ").toLowerCase().includes(query));
  }
  loadedRowCount(): number {
    switch (this.section()) {
      case "users": return this.users().length;
      case "workspaces": return this.workspaces().length;
      case "jobs": return this.jobs().length;
      case "consumption": return this.consumption().length;
      default: return 0;
    }
  }
  visibleRowCount(): number {
    switch (this.section()) {
      case "users": return this.visibleUsers().length;
      case "workspaces": return this.visibleWorkspaces().length;
      case "jobs": return this.visibleJobs().length;
      case "consumption": return this.visibleConsumption().length;
      default: return 0;
    }
  }
  hasLocalFilters(): boolean {
    return !!this.localSearch().trim() || !!this.jobKindFilter() || !!this.jobStatusFilter();
  }
  noRowsMessage(): string {
    return this.hasLocalFilters() ? "Ninguna fila consultada coincide con estos filtros." : "No hay filas en esta página autorizada.";
  }
  async setWorkspaceFilter(value: string): Promise<void> {
    this.workspaceFilter.set(value.trim());
    this.clearData();
    if (this.section() && this.isElevated()) await this.loadSection();
  }
  async loadNextPage(): Promise<void> {
    const cursor = this.nextBeforeId();
    if (!cursor || this.loadingPage() || !this.isElevated()) return;
    await this.loadSection(cursor);
  }
  async loadSection(beforeId?: string): Promise<void> {
    this.now.set(Date.now());
    const section = this.section();
    const access = this.access();
    if (!section || !access?.granted || !access.mfaEnabled || !this.isElevated() || !access.permissions.includes(`${section}.read` as AdminPermission) || this.loadingPage()) return;
    const workspaceId = section === "users" ? undefined : this.workspaceFilter().trim() || undefined;
    if (workspaceId && !this.validWorkspaceFilter(workspaceId)) {
      this.error.set("Escribe un UUID de espacio válido para filtrar.");
      return;
    }
    const version = ++this.pageVersion;
    this.loadingPage.set(true);
    this.pageFailed.set(false);
    this.error.set("");
    try {
      if (section === "users") {
        const result = await this.api.users(beforeId);
        if (!this.isCurrentPage(version, section, workspaceId)) return;
        this.users.update((items) => beforeId ? [...items, ...result.items] : result.items);
        this.nextBeforeId.set(result.nextBeforeId);
      } else if (section === "workspaces") {
        const result = await this.api.workspaces(beforeId, workspaceId);
        if (!this.isCurrentPage(version, section, workspaceId)) return;
        this.workspaces.update((items) => beforeId ? [...items, ...result.items] : result.items);
        this.nextBeforeId.set(result.nextBeforeId);
      } else if (section === "jobs") {
        const result = await this.api.jobs(beforeId, workspaceId);
        if (!this.isCurrentPage(version, section, workspaceId)) return;
        this.jobs.update((items) => beforeId ? [...items, ...result.items] : result.items);
        this.nextBeforeId.set(result.nextBeforeId);
      } else {
        const result = await this.api.consumption(beforeId, workspaceId);
        if (!this.isCurrentPage(version, section, workspaceId)) return;
        this.consumption.update((items) => beforeId ? [...items, ...result.items] : result.items);
        this.nextBeforeId.set(result.nextBeforeId);
      }
    } catch (error) {
      if (!this.isCurrentPage(version, section, workspaceId)) return;
      this.clearData();
      this.pageFailed.set(true);
      this.error.set(this.adminError(error));
      if (this.httpStatus(error) === 401 || this.errorIsForbidden(error)) {
        this.accessVersion += 1;
        this.access.set(null);
        this.loadingAccess.set(false);
        this.elevatedUntil.set("");
        this.message.set("");
      }
    } finally {
      if (version === this.pageVersion) this.loadingPage.set(false);
    }
  }
  workspaceScopeHint(): string {
    return this.access()?.workspaceIds === null
      ? "Scope global autorizado; el filtro es opcional."
      : "Sin filtro se consulta únicamente la lista de espacios autorizada por el servidor.";
  }
  private validWorkspaceFilter(value: string): boolean {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return false;
    const scope = this.access()?.workspaceIds;
    return scope === null || !!scope?.includes(value);
  }
  private isCurrentPage(version: number, section: AdminSection, workspaceId?: string): boolean {
    this.now.set(Date.now());
    return version === this.pageVersion && section === this.section() && workspaceId === (section === "users" ? undefined : this.workspaceFilter().trim() || undefined) && this.isElevated();
  }
  private adminError(error: unknown): string {
    const status = this.httpStatus(error);
    if (status === 403) return "El servidor rechazó el acceso. Comprueba tus permisos y vuelve a confirmar la sesión si la elevación caducó.";
    if (status === 503) return "La consulta administrativa no está disponible. Reintenta cuando el servicio se recupere.";
    return errorMessage(error);
  }
  jobKind(value: string): string {
    return ({ audio: "Audio", render: "Exportación", analysis: "Análisis", pipeline: "Procesamiento" } as Record<string, string>)[value] ?? "Sin clasificar";
  }
  jobStatus(value: string): string {
    return ({ queued: "En espera", running: "En curso", transcribing: "Transcribiendo", selecting: "Seleccionando", audio: "Preparando audio", analysis: "Analizando", render: "Exportando", stopping: "Deteniéndose", succeeded: "Completado", failed: "Fallido", cancelled: "Cancelado" } as Record<string, string>)[value] ?? "Sin clasificar";
  }
  jobStatusTone(value: string): string {
    if (value === "succeeded") return "success";
    if (value === "failed") return "error";
    if (value === "cancelled" || value === "stopping") return "stopped";
    if (["running", "transcribing", "selecting", "audio", "analysis", "render"].includes(value)) return "active";
    return value === "queued" ? "queued" : "unknown";
  }
  private errorIsForbidden(error: unknown): boolean {
    return this.httpStatus(error) === 403;
  }
  private httpStatus(error: unknown): number | null {
    return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : null;
  }
  private authorityChanged(previous: Schema<"AdminAccessDto">, next: Schema<"AdminAccessDto">): boolean {
    const permissions = (value: Schema<"AdminAccessDto">) => [...value.permissions].sort();
    const workspaces = (value: Schema<"AdminAccessDto">) => value.workspaceIds === null ? null : [...value.workspaceIds].sort();
    return previous.granted !== next.granted || previous.mfaEnabled !== next.mfaEnabled ||
      JSON.stringify(permissions(previous)) !== JSON.stringify(permissions(next)) ||
      JSON.stringify(workspaces(previous)) !== JSON.stringify(workspaces(next));
  }
  private clearData(): void {
    this.pageVersion += 1;
    this.users.set([]);
    this.workspaces.set([]);
    this.jobs.set([]);
    this.consumption.set([]);
    this.nextBeforeId.set(null);
    this.localSearch.set("");
    this.jobKindFilter.set("");
    this.jobStatusFilter.set("");
    this.loadingPage.set(false);
    this.pageFailed.set(false);
  }
}
