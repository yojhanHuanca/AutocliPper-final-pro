import { DESIGN_MODE } from "../../../core/config/design-mode.token";
import { ProjectsApi } from "../data-access/projects-api.service";
import { downloadPrivateArtifact } from '../../../core/http/artifact-download';
import { WorkspaceStore } from "../../workspaces/data-access/workspace.store";
import {
  ViewEncapsulation,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from "@angular/core";
import { DatePipe, DecimalPipe } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import type { Response } from "../../../core/contracts/api-types";
import type { Schema } from "../../../core/contracts/api-types";
import { SessionStore } from "../../../core/auth/session.store";
import { errorMessage } from "../../../core/http/api-error";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { SourceLinkPreviewComponent } from '../components/source-link-preview.component';

type EditList = Response<"/v1/projects/{id}/edits">;
@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-project",
  imports: [FormsModule, RouterLink, DatePipe, DecimalPipe, IconComponent, SourceLinkPreviewComponent],
  templateUrl: "./project-detail.component.html",
  styleUrl: "./project-detail.component.css",
})
export class ProjectComponent {
  readonly workspace = inject(WorkspaceStore);
  readonly design = inject(DESIGN_MODE);

  private readonly api = inject(ProjectsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly destroy = inject(DestroyRef);
  private readonly activeId = signal(this.route.snapshot.paramMap.get("id") ?? "");
  get id(): string { return this.activeId(); }
  readonly project = signal<Schema<"ProjectResponseDto"> | null>(null);
  readonly edits = signal<EditList["items"]>([]);
  readonly editsLoaded = signal(false);
  readonly editsLoading = signal(false);
  readonly editsError = signal('');
  private editsGeneration = 0;
  readonly createdDraft = signal<Schema<'EditorDraftDto'> | null>(null);
  readonly handoffNotice = signal('');
  private createdDraftRequest = '';
  readonly uploadStatus = signal<Schema<"UploadStatusDto"> | null>(null);
  readonly pipeline = signal<Schema<"PipelineStatusDto"> | null>(null);
  readonly busy = signal(false);
  readonly uploading = signal(false);
  readonly error = signal("");
  readonly loadNotice = signal("");
  readonly message = signal("");
  readonly uploadError = signal("");
  readonly pipelineError = signal("");
  readonly inspecting = signal(false);
  readonly pollingPipeline = signal(false);
  readonly sourceDurationSeconds = computed<number | null>(() => {
    const status = this.uploadStatus();
    if (!status || status.id !== this.uploadId.trim() || status.projectId !== this.id || status.state !== "confirmed" || status.inspection?.status !== "succeeded") return null;
    const duration = status.inspection?.result?.durationSeconds;
    return typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : null;
  });
  readonly sourceSelectionLimitSeconds = computed(() => Math.min(300, this.sourceDurationSeconds() ?? 300));
  readonly projectRole = computed(() => {
    if (!this.workspace.loaded()) return "loading" as const;
    const project = this.project();
    if (!project) return "loading-project" as const;
    return this.workspace.workspaces().find((item) => item.id === project.workspaceId)?.role ?? "unavailable" as const;
  });
  file: File | null = null;
  uploadId = "";
  pipelineId = "";
  private pipelineUploadId = '';
  private uploadGeneration = 0;
  private pipelineGeneration = 0;
  startSeconds = 0;
  endSeconds = 30;
  aspect: Schema<"PipelineSpecDto">["aspect"] = "vertical";
  language: Schema<"PipelineSpecDto">["language"] = "auto";
  private timer?: ReturnType<typeof setTimeout>;
  private inspectionTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private pipelineKey = "";
  private pipelineBody = "";
  private editKey = "";
  private editBody = "";
  private projectGeneration = 0;
  private intervalUploadId = "";
  private activeUploadController?: AbortController;
  private activeUploadId = "";
  readonly cancellingUpload = signal(false);
  readonly workbench = signal<"source" | "processing" | "drafts">("source");
  readonly sourceMode = signal<'file' | 'link'>('file');
  showSource(mode: 'file' | 'link', focus = false): void {
    this.sourceMode.set(mode);
    if (focus) requestAnimationFrame(() => { if (!this.disposed) document.getElementById('source-mode-file')?.focus(); });
  }
  readonly workbenchTabs = [
    { id: "source", label: "Video de origen", step: "source", icon: "upload" },
    { id: "processing", label: "Procesar clip", step: "render", icon: "scissors" },
    { id: "drafts", label: "Borradores", step: "draft", icon: "film" },
  ] as const;
  showWorkbench(section: "source" | "processing" | "drafts", focus = false): void {
    this.workbench.set(section);
    if (focus && typeof requestAnimationFrame === "function") requestAnimationFrame(() => { if (!this.disposed) document.getElementById(`project-${section}-panel`)?.focus(); });
  }
  onWorkbenchKey(event: KeyboardEvent, index: number): void {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % this.workbenchTabs.length;
    else if (event.key === "ArrowLeft") next = (index + this.workbenchTabs.length - 1) % this.workbenchTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = this.workbenchTabs.length - 1;
    else return;
    event.preventDefault();
    this.workbench.set(this.workbenchTabs[next].id);
    requestAnimationFrame(() => document.getElementById(`project-tab-${this.workbenchTabs[next].id}`)?.focus());
  }
  continueLabel(): string {
    if (this.createdDraft()) return "Abrir borrador guardado";
    if (this.edits().length) return "Abrir un borrador";
    return this.inspected() ? "Preparar el corte" : "Elegir mi video";
  }
  async continueProject(): Promise<void> {
    if (this.disposed || this.design || !this.project() || this.busy()) return;
    if (this.createdDraft()) { await this.openCreatedDraft(); return; }
    const draft = this.edits()[0];
    if (draft) { await this.router.navigateByUrl(`/app/edits/${encodeURIComponent(draft.id)}`); return; }
    this.showWorkbench(this.inspected() ? "processing" : "source", true);
  }
  hasActiveUpload(): boolean { return !!this.activeUploadId; }
  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroy)).subscribe((params) => {
      const nextId = params.get("id") ?? "";
      if (nextId !== this.id) this.switchProject(nextId);
    });
    this.destroy.onDestroy(() => {
      this.disposed = true;
      this.projectGeneration++;
      this.uploadGeneration++;
      this.pipelineGeneration++;
      clearTimeout(this.timer);
      clearTimeout(this.inspectionTimer);
      this.activeUploadController?.abort();
      if (this.activeUploadId) void this.api.abortUpload(this.activeUploadId).catch(() => undefined);
    });
    void this.reload();
  }
  private storageKey(): string {
    const userId = this.session.user()?.id;
    return userId && this.id ? `ac:resume:${userId}:${this.id}` : "";
  }
  private remember(): void {
    try {
      const key = this.storageKey();
      if (!key) return;
      if (!this.uploadId && !this.pipelineId) { sessionStorage.removeItem(key); return; }
      sessionStorage.setItem(
        key,
        JSON.stringify({ uploadId: this.uploadId, pipelineId: this.pipelineId, pipelineUploadId: this.pipelineUploadId }),
      );
    } catch { /* The workflow remains usable when this browser blocks session storage. */ }
  }
  private restoreReferences(): void {
    if (!this.session.user()?.id || !this.workspace.loaded() || !this.project() || this.projectRole() === "unavailable") return;
    try {
      const key = this.storageKey();
      if (!key) return;
      const stored = sessionStorage.getItem(key);
      if (!stored) return;
      const refs: { uploadId?: string; pipelineId?: string; pipelineUploadId?: string } = JSON.parse(stored);
      this.uploadId = typeof refs.uploadId === "string" ? refs.uploadId : "";
      this.pipelineId = typeof refs.pipelineId === "string" ? refs.pipelineId : "";
      // Pipeline status has no upload provenance; never trust that link from browser storage.
      this.pipelineUploadId = "";
    } catch {
      /* Ignore an invalid or unavailable local resume reference. */
    }
  }
  private clearResumeReferences(): void {
    this.uploadGeneration++;
    this.pipelineGeneration++;
    clearTimeout(this.timer);
    clearTimeout(this.inspectionTimer);
    this.inspecting.set(false);
    this.pollingPipeline.set(false);
    try { const key = this.storageKey(); if (key) sessionStorage.removeItem(key); } catch { /* Storage is optional. */ }
    this.uploadId = "";
    this.pipelineId = "";
    this.pipelineUploadId = "";
    this.uploadStatus.set(null);
    this.pipeline.set(null);
  }
  private isAccessFailure(error: unknown): boolean {
    return error instanceof HttpErrorResponse && (error.status === 403 || error.status === 404);
  }
  private clearProjectAccess(): void {
    this.clearResumeReferences();
    this.project.set(null);
    this.edits.set([]);
    this.editsLoaded.set(false);
    this.createdDraft.set(null);
    this.createdDraftRequest = '';
    this.handoffNotice.set('');
  }
  private switchProject(id: string): void {
    this.sourceMode.set('file');
    this.workbench.set("source");
    if (this.activeUploadId) void this.api.abortUpload(this.activeUploadId).catch(() => undefined);
    this.activeUploadController?.abort();
    this.activeUploadController = undefined;
    this.activeUploadId = "";
    this.projectGeneration++;
    this.uploadGeneration++;
    this.pipelineGeneration++;
    clearTimeout(this.timer);
    clearTimeout(this.inspectionTimer);
    this.timer = undefined;
    this.inspectionTimer = undefined;
    this.activeId.set(id);
    this.project.set(null);
    this.edits.set([]);
    this.editsGeneration++;
    this.editsLoaded.set(false);
    this.editsLoading.set(false);
    this.editsError.set('');
    this.createdDraft.set(null);
    this.createdDraftRequest = '';
    this.handoffNotice.set('');
    this.uploadStatus.set(null);
    this.pipeline.set(null);
    this.busy.set(false);
    this.uploading.set(false);
    this.inspecting.set(false);
    this.pollingPipeline.set(false);
    this.cancellingUpload.set(false);
    this.error.set("");
    this.loadNotice.set("");
    this.message.set("");
    this.uploadError.set("");
    this.pipelineError.set("");
    this.file = null;
    this.uploadId = "";
    this.pipelineId = "";
    this.pipelineUploadId = "";
    this.intervalUploadId = "";
    this.startSeconds = 0;
    this.endSeconds = 30;
    this.aspect = "vertical";
    this.language = "auto";
    this.pipelineKey = "";
    this.pipelineBody = "";
    this.editKey = "";
    this.editBody = "";
    void this.reload();
  }
  canEdit(): boolean {
    if (this.design || !this.workspace.loaded()) return false;
    return ["owner", "admin", "editor"].includes(
      this.workspace
        .workspaces()
        .find((w) => w.id === this.project()?.workspaceId)?.role ?? "",
    );
  }
  inspected(): boolean {
    const status = this.uploadStatus();
    return status?.id === this.uploadId.trim() && status?.projectId === this.id && status.state === "confirmed" && status?.inspection?.status === 'succeeded';
  }
  roleNotice(): string {
    if (this.design) return 'Vista de estructura. Abre un proyecto de tu cuenta para cargar material y crear un borrador.';
    if (!this.project() && !this.busy() && this.error()) return 'No se pudo confirmar el acceso al proyecto. Vuelve a consultarlo antes de continuar.';
    const role = this.projectRole();
    if (role === "loading" || role === "loading-project") return "Comprobando el rol del espacio antes de habilitar cambios…";
    if (role === "unavailable") return "No se pudo confirmar tu rol en este espacio. Las acciones de edición permanecen deshabilitadas.";
    if (role === "reader") return "Tienes acceso de lectura. Para cargar, procesar o crear borradores necesitas un rol de editor o superior.";
    return "";
  }
  selectUpload(id: string): void {
    this.uploadId = id;
    this.uploadGeneration++;
    clearTimeout(this.inspectionTimer);
    this.uploadStatus.set(null);
    this.uploadError.set("");
    this.inspecting.set(false);
    this.intervalUploadId = "";
    this.startSeconds = 0;
    this.endSeconds = 30;
    this.remember();
  }
  selectPipeline(id: string): void {
    this.pipelineId = id;
    this.pipelineUploadId = '';
    this.pipelineGeneration++;
    clearTimeout(this.timer);
    this.pipeline.set(null);
    this.pipelineError.set("");
    this.pollingPipeline.set(false);
    this.remember();
  }
  hasLinkedTranscript(): boolean {
    const task = this.pipeline();
    return !!task?.analysisId && task.status === 'succeeded' && task.id === this.pipelineId.trim() && this.pipelineUploadId === this.uploadId.trim();
  }
  hasDraftForSelectedUpload(): boolean {
    const uploadId = this.uploadId.trim();
    return !!uploadId && this.edits().some((edit) => edit.uploadId === uploadId);
  }
  pipelineInProgress(): boolean {
    const status = this.pipeline()?.status;
    return !!status && ["queued", "audio", "analysis", "render", "stopping"].includes(status);
  }
  pipelineBlocksSelectedUpload(): boolean {
    return this.pipelineInProgress() && (!this.hasKnownPipelineUpload() || this.pipelineMatchesSelectedUpload());
  }
  pipelineActionLabel(): string {
    if (this.pollingPipeline() && !this.pipeline()) return "Consultando procesamiento…";
    if (this.pipelineBlocksSelectedUpload()) return "Procesamiento en curso";
    if (this.pipeline()?.status === "succeeded" && this.pipelineMatchesSelectedUpload()) return "Procesar de nuevo";
    if (this.pipeline()?.status === "failed" || this.pipeline()?.status === "cancelled") return "Reintentar procesamiento";
    return "Procesar intervalo";
  }
  workflowStatus(step: "source" | "render" | "draft"): string {
    if (step === "source") {
      if (this.inspected()) return "Listo";
      const status = this.uploadStatus();
      if (status?.state === "aborted") return "Cancelado";
      if (status?.state === "pending") return "Carga pendiente";
      if (status?.inspection?.status === "failed") return "Revisar archivo";
      if (status?.inspection?.status === "queued" || status?.inspection?.status === "running") return "En inspección";
      return "Pendiente";
    }
    if (step === "render") {
      const task = this.pipeline();
      if (task) {
        if (!this.hasKnownPipelineUpload()) return "Vínculo no confirmado";
        if (!this.pipelineMatchesSelectedUpload()) return "Otra carga";
        if (this.pipelineInProgress()) return "En proceso";
        if (task.status === "succeeded") return "MP4 disponible";
        if (task.status === "failed") return "No completado";
        if (task.status === "cancelled") return "Cancelado";
      }
      return this.inspected() ? "Disponible" : "Tras inspección";
    }
    if (this.hasDraftForSelectedUpload()) return "Borrador listo";
    if (this.edits().length) return "Otros borradores del proyecto";
    return this.inspected() ? "Disponible" : "Tras inspección";
  }
  pipelineMatchesSelectedUpload(): boolean {
    return !!this.pipelineUploadId && this.pipelineUploadId === this.uploadId.trim();
  }
  hasKnownPipelineUpload(): boolean {
    return !!this.pipelineUploadId;
  }
  uploadStateLabel(state: Schema<"UploadStatusDto">["state"]): string {
    return { pending: "Pendiente de transferencia", confirmed: "Confirmada", aborted: "Cancelada" }[state];
  }
  inspectionLabel(state: string | undefined): string {
    return ({ queued: "En cola", running: "Inspeccionando", succeeded: "Lista para procesar", failed: "No superó la inspección" } as Record<string, string>)[state ?? ""] ?? "Pendiente de inspección";
  }
  pipelineStateLabel(state: Schema<"PipelineStatusDto">["status"]): string {
    return ({ queued: "En cola", audio: "Preparando audio", analysis: "Transcribiendo", render: "Creando el clip", stopping: "Cancelación solicitada", succeeded: "Completado", failed: "No se pudo completar", cancelled: "Cancelado" } as Record<string, string>)[state] ?? state;
  }
  eventStateLabel(state: string): string {
    return ({ queued: "En cola", audio: "Preparando audio", analysis: "Transcribiendo", render: "Creando el clip", stopping: "Cancelación solicitada", succeeded: "Completado", failed: "Error", cancelled: "Cancelado" } as Record<string, string>)[state] ?? state;
  }
  choose(event: Event): void {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
  }
  setIntervalField(field: 'startSeconds' | 'endSeconds', value: number | null): void {
    if (this.busy() || !this.canEdit() || !this.inspected()) return;
    this[field] = typeof value === 'number' ? value : Number.NaN;
  }
  async reload(): Promise<void> {
    if (this.design || this.busy()) return;
    const generation = this.projectGeneration;
    const editsRequest = ++this.editsGeneration;
    const projectId = this.id;
    this.editsLoading.set(true);
    await this.run(async () => {
      this.loadNotice.set("");
      const [projectResult, editsResult] = await Promise.allSettled([
        this.api.get(projectId),
        this.api.edits(projectId),
      ]);
      if (!this.isCurrentProject(generation)) return;
      if (projectResult.status === "rejected") {
        if (this.isAccessFailure(projectResult.reason)) this.clearProjectAccess();
        this.editsError.set('No se pudo confirmar el acceso al proyecto para mostrar sus borradores.');
        throw projectResult.reason;
      }
      if (projectResult.value.id !== projectId) throw new Error("La respuesta no corresponde al proyecto solicitado.");
      this.project.set(projectResult.value);
      this.restoreReferences();
      if (editsRequest !== this.editsGeneration) return;
      if (editsResult.status === "fulfilled") {
        this.edits.set(editsResult.value.items);
        this.editsLoaded.set(true);
        this.editsError.set('');
      } else {
        this.editsError.set(`No se pudieron cargar los borradores: ${errorMessage(editsResult.reason)}`);
      }
    });
    if (this.isCurrentProject(generation) && editsRequest === this.editsGeneration) this.editsLoading.set(false);
    if (!this.isCurrentProject(generation)) return;
    if (this.uploadId) await this.inspect();
    if (!this.isCurrentProject(generation)) return;
    if (this.pipelineId) await this.pollPipeline();
  }
  async reloadEdits(): Promise<void> {
    if (this.design || this.busy() || this.editsLoading() || !this.project()) return;
    const generation = this.projectGeneration;
    const request = ++this.editsGeneration;
    this.editsLoading.set(true);
    try {
      const result = await this.api.edits(this.id);
      if (!this.isCurrentProject(generation) || request !== this.editsGeneration) return;
      this.edits.set(result.items);
      this.editsLoaded.set(true);
      this.editsError.set('');
    } catch (error) {
      if (this.isCurrentProject(generation) && request === this.editsGeneration) {
        if (this.isAccessFailure(error)) this.clearProjectAccess();
        this.editsError.set(`No se pudieron cargar los borradores: ${errorMessage(error)}`);
      }
    } finally {
      if (this.isCurrentProject(generation) && request === this.editsGeneration) this.editsLoading.set(false);
    }
  }
  async upload(): Promise<void> {
    if (!this.file || this.busy() || !this.canEdit()) return;
    const generation = this.projectGeneration;
    const file = this.file;
    const controller = new AbortController();
    this.activeUploadController = controller;
    this.activeUploadId = "";
    this.cancellingUpload.set(false);
    this.uploading.set(true);
    await this.run(async () => {
      const status = await this.api.uploadFile(
        this.id,
        file,
        (stage) => { if (this.isCurrentProject(generation)) this.message.set(stage); },
        (id) => {
          if (!this.isCurrentProject(generation)) return;
          this.activeUploadId = id;
          this.selectUpload(id);
          this.remember();
        },
        controller.signal,
      );
      if (!this.isCurrentProject(generation)) return;
      this.uploadStatus.set(status);
      this.message.set(
        "Carga confirmada. Consulta abajo el estado de inspección antes de continuar.",
      );
    });
    if (this.activeUploadController && this.activeUploadController.signal.aborted && !this.cancellingUpload()) {
      this.activeUploadController = undefined;
      this.activeUploadId = "";
    }
    if (!this.isCurrentProject(generation)) return;
    this.uploading.set(false);
    this.activeUploadController = undefined;
    this.activeUploadId = "";
    if (this.uploadStatus()) await this.inspect();
  }
  async inspect(): Promise<void> {
    clearTimeout(this.inspectionTimer);
    if (this.design || !this.uploadId) return;
    const projectGeneration = this.projectGeneration;
    const id = this.uploadId.trim(), generation = ++this.uploadGeneration;
    this.inspecting.set(true);
    this.uploadError.set("");
    try {
      const status = await this.api.upload(id);
      if (generation !== this.uploadGeneration || !this.isCurrentProject(projectGeneration)) return;
      if (status.projectId !== this.id)
        throw new Error("La carga consultada pertenece a otro proyecto.");
      this.uploadStatus.set(status);
      this.uploadError.set("");
      const duration = status.inspection?.result?.durationSeconds;
      if (status.inspection?.status === "succeeded" && this.intervalUploadId !== id) {
        this.startSeconds = 0;
        this.endSeconds = Math.max(0.1, Math.min(30, duration ?? 30, 300));
        this.intervalUploadId = id;
      }
      this.remember();
      if (
        !this.disposed &&
        status.state === "confirmed" &&
        !["succeeded", "failed"].includes(status.inspection?.status ?? "")
      )
        this.inspectionTimer = setTimeout(() => void this.inspect(), 4000);
    } catch (error) {
      if (generation !== this.uploadGeneration || !this.isCurrentProject(projectGeneration)) return;
      if (this.isAccessFailure(error)) this.clearResumeReferences();
      this.uploadError.set(errorMessage(error));
    } finally {
      if (generation === this.uploadGeneration && this.isCurrentProject(projectGeneration)) this.inspecting.set(false);
    }
  }
  async abortUpload(): Promise<void> {
    if (!this.canEdit()) return;
    const generation = this.projectGeneration;
    const id = this.uploadId.trim();
    await this.run(async () => {
      await this.api.abortUpload(id);
      if (!this.isCurrentProject(generation)) return;
      if (this.uploadId.trim() !== id) return;
      clearTimeout(this.inspectionTimer);
      this.uploadStatus.update((status) => status ? { ...status, state: "aborted" } : status);
      this.message.set("La carga pendiente se canceló y liberó su reserva temporal.");
    });
  }
  async cancelActiveUpload(): Promise<void> {
    if (!this.canEdit()) return;
    const id = this.activeUploadId;
    const generation = this.projectGeneration;
    if (!id || this.cancellingUpload()) return;
    this.cancellingUpload.set(true);
    this.activeUploadController?.abort();
    try {
      await this.api.abortUpload(id);
      if (this.isCurrentProject(generation) && this.uploadId.trim() === id) {
        this.message.set("La transferencia se detuvo y la carga temporal se liberó.");
        this.uploadError.set("");
        this.uploadStatus.update((status) => status?.id === id ? { ...status, state: "aborted" } : status);
        this.remember();
      }
    } catch (error) {
      if (this.isCurrentProject(generation)) this.uploadError.set(`Se detuvo la transferencia, pero no se pudo confirmar la liberación de la carga ${id}. Consulta su estado o reintenta la cancelación. ${errorMessage(error)}`);
    } finally { if (this.isCurrentProject(generation)) this.cancellingUpload.set(false); }
  }
  private validateInterval(): void {
    if (
      !Number.isFinite(this.startSeconds) ||
      !Number.isFinite(this.endSeconds) ||
      this.startSeconds < 0 ||
      this.endSeconds - this.startSeconds < 0.1 ||
      this.endSeconds - this.startSeconds > 120 ||
        this.endSeconds > this.sourceSelectionLimitSeconds()
    )
      throw new Error(`El intervalo debe durar entre 0,1 y 120 segundos y quedar dentro del límite procesable${this.sourceDurationSeconds() ? ` (${this.sourceSelectionLimitSeconds()} s)` : " de 300 segundos"}.`);
  }
  async startPipeline(): Promise<void> {
    if (!this.canEdit()) return;
    const generation = this.projectGeneration;
    await this.run(async () => {
      if (this.pollingPipeline() || this.pipelineBlocksSelectedUpload()) throw new Error("Ya hay un procesamiento activo para esta carga. Espera a que termine o solicita su cancelación.");
      if (!this.inspected()) throw new Error('Consulta una carga inspeccionada de este proyecto antes de procesar.');
      const uploadId = this.uploadId.trim();
      this.validateInterval();
      const body: Schema<"PipelineSpecDto"> = {
        version: 1,
        provider: "whisper_cpp",
        language: this.language,
        selection: { mode: "none" },
        startSeconds: this.startSeconds,
        endSeconds: this.endSeconds,
        aspect: this.aspect,
      };
      const serialized = JSON.stringify({ uploadId, body });
      if (serialized !== this.pipelineBody) {
        this.pipelineBody = serialized;
        this.pipelineKey = crypto.randomUUID();
      }
      const result = await this.api.createPipeline(
        uploadId,
        body,
        this.pipelineKey,
      );
      if (!this.isCurrentProject(generation) || this.uploadId.trim() !== uploadId) return;
      this.selectPipeline(result.id);
      this.pipelineUploadId = uploadId;
      this.pipeline.set(result);
      this.pipelineId = result.id;
      this.remember();
      this.pipelineKey = "";
      this.pipelineBody = "";
    });
    if (this.pipelineId) await this.pollPipeline();
  }
  async pollPipeline(): Promise<void> {
    clearTimeout(this.timer);
    if (this.design || !this.pipelineId) return;
    const projectGeneration = this.projectGeneration;
    const id = this.pipelineId.trim(), generation = ++this.pipelineGeneration;
    this.pollingPipeline.set(true);
    this.pipelineError.set("");
    try {
      const task = await this.api.pipeline(id);
      if (generation !== this.pipelineGeneration || !this.isCurrentProject(projectGeneration)) return;
      this.pipeline.set(task);
      this.pipelineError.set("");
      this.remember();
      if (
        !this.disposed &&
        !["succeeded", "failed", "cancelled"].includes(task.status)
      )
        this.timer = setTimeout(() => void this.pollPipeline(), 4000);
    } catch (error) {
      if (generation !== this.pipelineGeneration || !this.isCurrentProject(projectGeneration)) return;
      if (this.isAccessFailure(error)) this.clearResumeReferences();
      this.pipelineError.set(errorMessage(error));
    } finally {
      if (generation === this.pipelineGeneration && this.isCurrentProject(projectGeneration)) this.pollingPipeline.set(false);
    }
  }
  async cancelPipeline(): Promise<void> {
    if (!this.canEdit()) return;
    const generation = this.projectGeneration;
    const id = this.pipelineId.trim();
    await this.run(async () => {
      await this.api.cancelPipeline(id);
      if (!this.isCurrentProject(generation) || this.pipelineId.trim() !== id) return;
      await this.pollPipeline();
    });
  }
  async downloadPipeline(artifact: 'video' | 'srt' | 'vtt'): Promise<void> {
    const id = this.pipelineId.trim();
    const generation = this.projectGeneration;
    if (this.pipeline()?.id !== id || this.pipeline()?.status !== 'succeeded') return;
    await this.run(async () => {
      const result = await this.api.pipelineDownload(id, artifact);
      if (!this.isCurrentProject(generation) || this.pipelineId.trim() !== id) return;
      await downloadPrivateArtifact(result.url, `autoclipper-${id}.${artifact === 'video' ? 'mp4' : artifact}`);
    });
  }
  async createEdit(): Promise<void> {
    if (!this.canEdit()) return;
    const generation = this.projectGeneration;
    await this.run(async () => {
      if (!this.inspected()) throw new Error('Consulta una carga inspeccionada de este proyecto antes de crear el borrador.');
      const uploadId = this.uploadId.trim();
      this.validateInterval();
      const body = this.draftRequestBody();
      const serialized = JSON.stringify({ uploadId, body });
      const existing = this.createdDraft();
      if (existing && serialized === this.createdDraftRequest) {
        await this.navigateToDraft(existing, generation);
        return;
      }
      if (serialized !== this.editBody) {
        this.editBody = serialized;
        this.editKey = crypto.randomUUID();
      }
      const result = await this.api.createEdit(
        uploadId,
        body,
        this.editKey,
      );
      if (!this.isCurrentProject(generation)) return;
      if (result.projectId !== this.id || result.uploadId !== uploadId)
        throw new Error('La respuesta no corresponde al proyecto y la carga del borrador solicitado.');
      this.createdDraft.set(result);
      this.createdDraftRequest = serialized;
      this.editKey = "";
      this.editBody = "";
      this.message.set(`Borrador «${result.name}» creado. Revisión ${result.version} guardada.`);
      if (this.uploadId.trim() !== uploadId) {
        this.handoffNotice.set('El borrador se creó para la carga anterior. Puedes abrirlo desde el resultado guardado de abajo.');
        return;
      }
      await this.navigateToDraft(result, generation);
    });
  }
  private draftRequestBody(): Schema<'CreateEditDto'> {
    const analysisId = this.hasLinkedTranscript() ? this.pipeline()?.analysisId : null;
    return { name: `Clip ${this.startSeconds}–${this.endSeconds}s`, spec: {
      version: 1, kind: 'clip', startSeconds: this.startSeconds, endSeconds: this.endSeconds, aspect: this.aspect,
      subtitles: analysisId ? { source: 'transcript', analysisId } : { source: 'none' },
    } };
  }
  hasReusableDraft(): boolean {
    return !!this.createdDraft() && this.createdDraftRequest === JSON.stringify({ uploadId: this.uploadId.trim(), body: this.draftRequestBody() });
  }
  async openCreatedDraft(): Promise<void> {
    const draft = this.createdDraft();
    if (!draft || !this.project() || draft.projectId !== this.id) return;
    const generation = this.projectGeneration;
    await this.run(() => this.navigateToDraft(draft, generation));
  }
  private async navigateToDraft(draft: Schema<'EditorDraftDto'>, generation: number): Promise<void> {
    this.handoffNotice.set('');
    try {
      const navigated = await this.router.navigate(['/app/edits', draft.id]);
      if (this.isCurrentProject(generation) && !navigated)
        this.handoffNotice.set('El borrador está guardado, pero no se abrió el editor. Puedes volver a abrirlo sin crear otro.');
    } catch {
      if (this.isCurrentProject(generation))
        this.handoffNotice.set('El borrador está guardado. No pudimos abrir el editor; vuelve a intentarlo con «Abrir borrador guardado».');
    }
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.design || this.busy()) return;
    const generation = this.projectGeneration;
    this.busy.set(true);
    this.error.set("");
    this.loadNotice.set("");
    try {
      await action();
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError" && this.cancellingUpload();
      if (this.isCurrentProject(generation) && !cancelled) this.error.set(errorMessage(error));
    } finally {
      if (this.isCurrentProject(generation)) this.busy.set(false);
    }
  }
  private isCurrentProject(generation: number): boolean {
    return !this.disposed && generation === this.projectGeneration;
  }
}
