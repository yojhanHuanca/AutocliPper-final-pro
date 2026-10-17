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
  readonly loadingAccess = signal(true);
  readonly elevatedUntil = signal("");
  readonly now = signal(Date.now());
  readonly isElevated = computed(() => {
    const current = this.access();
    const until = current ? current.elevatedUntil : this.elevatedUntil();
    return !!until && Date.parse(until) > this.now();
  });
  readonly sections = [
    { id: "users", permission: "users.read", label: "Usuarios", icon: "users" },
    { id: "workspaces", permission: "workspaces.read", label: "Espacios", icon: "folder" },
    { id: "jobs", permission: "jobs.read", label: "Procesamiento", icon: "film" },
    { id: "consumption", permission: "consumption.read", label: "Consumo", icon: "chart" },
  ] as const satisfies ReadonlyArray<{ id: AdminSection; permission: AdminPermission; label: string; icon: string }>;
  readonly availableSections = computed(() => this.sections.filter((item) => this.access()?.permissions.includes(item.permission)));
  readonly section = signal<AdminSection | null>(null);
  readonly users = signal<Schema<"AdminUserDto">[]>([]);
  readonly workspaces = signal<Schema<"AdminWorkspaceDto">[]>([]);
  readonly jobs = signal<Schema<"AdminJobDto">[]>([]);
  readonly consumption = signal<Schema<"AdminConsumptionDto">[]>([]);
  readonly nextBeforeId = signal<string | null>(null);
  readonly loadingPage = signal(false);
  readonly error = signal("");
  readonly message = signal("");
  readonly mutationBusy = signal(false);
  readonly workspaceFilter = signal("");
  password = "";
  factor = "";
  private accessVersion = 0;
  private pageVersion = 0;

  constructor() {
    const clock = setInterval(() => {
      this.now.set(Date.now());
      if (!this.isElevated()) this.clearData();
    }, 30_000);
    this.destroyRef.onDestroy(() => {
      clearInterval(clock);
      this.pageVersion += 1;
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
    this.loadingAccess.set(true);
    this.error.set("");
    try {
      const result = await this.api.access();
      if (version !== this.accessVersion) return;
      this.access.set(result);
      this.elevatedUntil.set(result.elevatedUntil ?? "");
      if (!result.granted || !result.mfaEnabled || !result.elevatedUntil || Date.parse(result.elevatedUntil) <= Date.now()) {
        this.clearData();
        this.section.set(null);
      } else if (!this.section() || !result.permissions.includes(`${this.section()}.read` as AdminPermission)) {
        this.clearData();
        this.section.set(this.sections.find((item) => result.permissions.includes(item.permission))?.id ?? null);
        if (this.sections.some((item) => result.permissions.includes(item.permission))) void this.loadSection();
      }
    } catch (error) {
      if (version !== this.accessVersion) return;
      this.access.set(null);
      this.clearData();
      this.error.set(errorMessage(error));
    } finally {
      if (version === this.accessVersion) this.loadingAccess.set(false);
    }
  }
  async elevate(): Promise<void> {
    if (this.mutationBusy() || !this.access()?.granted || !this.access()?.mfaEnabled || !this.password || !this.factor.trim()) return;
    this.mutationBusy.set(true);
    this.error.set("");
    this.message.set("");
    try {
      const result = await this.api.elevate({ password: this.password, factor: this.factor.trim() });
      this.elevatedUntil.set(result.elevatedUntil);
      this.access.update((current) => current ? { ...current, elevatedUntil: result.elevatedUntil } : current);
      this.password = "";
      this.factor = "";
      this.now.set(Date.now());
      this.message.set("Acceso de consulta elevado por cinco minutos para esta sesión.");
      this.section.set(this.availableSections()[0]?.id ?? null);
      if (this.availableSections().length) await this.loadSection();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.mutationBusy.set(false);
      this.password = "";
      this.factor = "";
    }
  }
  async selectSection(section: AdminSection): Promise<void> {
    if (!this.availableSections().some((item) => item.id === section) || !this.isElevated()) return;
    this.section.set(section);
    this.clearData();
    await this.loadSection();
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
      this.error.set(errorMessage(error));
      this.clearData();
      if (this.errorIsForbidden(error)) void this.refreshAccess();
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
    return version === this.pageVersion && section === this.section() && workspaceId === (section === "users" ? undefined : this.workspaceFilter().trim() || undefined) && this.isElevated();
  }
  private errorIsForbidden(error: unknown): boolean {
    return typeof error === "object" && error !== null && "status" in error && error.status === 403;
  }
  private clearData(): void {
    this.pageVersion += 1;
    this.users.set([]);
    this.workspaces.set([]);
    this.jobs.set([]);
    this.consumption.set([]);
    this.nextBeforeId.set(null);
    this.loadingPage.set(false);
  }
}
