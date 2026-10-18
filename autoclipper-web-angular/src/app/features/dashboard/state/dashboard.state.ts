import { DestroyRef, Injectable, inject, signal } from "@angular/core";
import type { Schema, Response } from "../../../core/contracts/api-types";
import { errorMessage } from "../../../core/http/api-error";
import { ProjectsApi } from "../../projects/data-access/projects-api.service";
import { ConsumptionApi } from "../../consumption/data-access/consumption-api.service";
import { WorkspaceStore } from "../../workspaces/data-access/workspace.store";

type Draft = Response<"/v1/projects/{id}/edits">["items"][number];
export type HomeDraft = Draft & { projectId: string; projectName: string };
export type HomeSource = Schema<"UploadStatusDto"> & { projectName: string };

@Injectable()
export class DashboardState {
  private readonly api = inject(ProjectsApi);
  private readonly billing = inject(ConsumptionApi);
  private readonly workspace = inject(WorkspaceStore);
  readonly projects = signal<Schema<"ProjectSummaryDto">[]>([]);
  readonly drafts = signal<HomeDraft[]>([]);
  readonly sources = signal<HomeSource[]>([]);
  readonly usage = signal<Schema<"ConsumptionDto"> | null>(null);
  readonly loading = signal(false);
  readonly projectsLoaded = signal(false);
  readonly detailsLoaded = signal(false);
  readonly error = signal("");
  readonly denied = signal(false);
  readonly usageError = signal("");
  readonly draftsError = signal("");
  readonly sourcesError = signal("");
  private generation = 0;
  constructor() { inject(DestroyRef).onDestroy(() => { this.generation += 1; }); }

  async load(id: string): Promise<void> {
    const generation = ++this.generation;
    this.projects.set([]); this.drafts.set([]); this.sources.set([]); this.usage.set(null);
    this.projectsLoaded.set(false); this.detailsLoaded.set(false);
    this.denied.set(false);
    this.error.set(""); this.usageError.set(""); this.draftsError.set(""); this.sourcesError.set("");
    this.loading.set(!!id);
    if (!id) return;
    try {
      const [projects, usage] = await Promise.allSettled([this.api.list(id), this.billing.overview(id)]);
      if (!this.current(generation, id)) return;
      if ([projects, usage].some(result => result.status === "rejected" && this.accessFailure(result.reason))) { this.closeAccess(); return; }
      if (usage.status === "fulfilled" && usage.value.workspaceId === id) this.usage.set(usage.value);
      else this.usageError.set(usage.status === "rejected" ? errorMessage(usage.reason) : "El resumen no corresponde al espacio seleccionado.");
      if (projects.status === "rejected") { this.error.set(errorMessage(projects.reason)); return; }
      if (projects.value.items.some(project => project.workspaceId !== id)) { this.error.set("La lista recibida no corresponde al espacio seleccionado."); return; }
      const ordered = [...projects.value.items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      this.projects.set(ordered);
      this.projectsLoaded.set(true);
      const recent = ordered.slice(0, 4);
      const pages = await Promise.allSettled(recent.map(project => this.api.edits(project.id)));
      if (!this.current(generation, id)) return;
      if (pages.some(result => result.status === "rejected" && this.accessFailure(result.reason))) { this.closeAccess(); return; }
      const drafts: HomeDraft[] = [];
      pages.forEach((page, index) => {
        if (page.status === "fulfilled") drafts.push(...page.value.items.map(draft => ({ ...draft, projectId: recent[index].id, projectName: recent[index].name })));
      });
      this.drafts.set(drafts.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 6));
      this.detailsLoaded.set(true);
      if (pages.some(page => page.status === "rejected")) this.draftsError.set("Algunos borradores no se pudieron consultar. Puedes reintentar o abrir su proyecto.");
      const references = this.drafts().filter((draft, index, all) => all.findIndex(item => item.uploadId === draft.uploadId) === index).slice(0, 3);
      const uploads = await Promise.allSettled(references.map(draft => this.api.upload(draft.uploadId)));
      if (!this.current(generation, id)) return;
      if (uploads.some(result => result.status === "rejected" && this.accessFailure(result.reason))) { this.closeAccess(); return; }
      const sources: HomeSource[] = [];
      uploads.forEach((upload, index) => {
        const reference = references[index];
        if (upload.status === "fulfilled" && upload.value.id === reference.uploadId && upload.value.projectId === reference.projectId) sources.push({ ...upload.value, projectName: reference.projectName });
        else this.sourcesError.set("No se pudieron confirmar todas las fuentes de los borradores consultados.");
      });
      this.sources.set(sources);
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }
  private current(generation: number, id: string): boolean { return generation === this.generation && this.workspace.workspaceId() === id; }
  private accessFailure(error: unknown): boolean {
    return typeof error === "object" && error !== null && "status" in error && [401, 403].includes(Number(error.status));
  }
  private closeAccess(): void {
    this.denied.set(true);
    this.projects.set([]); this.drafts.set([]); this.sources.set([]); this.usage.set(null);
    this.projectsLoaded.set(false); this.detailsLoaded.set(false);
    this.error.set("El servidor no confirmó acceso a este espacio. Actualiza tus espacios o vuelve a iniciar sesión.");
  }
}
