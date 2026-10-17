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
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import type { Response } from "../../../core/contracts/api-types";
import type { Schema } from "../../../core/contracts/api-types";
import { SessionStore } from "../../../core/auth/session.store";
import { errorMessage } from "../../../core/http/api-error";
import { IconComponent } from "../../../shared/ui/icon/icon.component";

type EditList = Response<"/v1/projects/{id}/edits">;
@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-project",
  imports: [FormsModule, RouterLink, DatePipe, DecimalPipe, IconComponent],
  templateUrl: "./project-detail.component.html",
  styleUrl: "./project-detail.component.css",
})
export class ProjectComponent {
  readonly workspace = inject(WorkspaceStore);

  private readonly api = inject(ProjectsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly destroy = inject(DestroyRef);
  private readonly activeId = signal(this.route.snapshot.paramMap.get("id") ?? "");
  get id(): string { return this.activeId(); }
  readonly project = signal<Schema<"ProjectResponseDto"> | null>(null);
  readonly edits = signal<EditList["items"]>([]);
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
  readonly sourceDurationSeconds = computed(() => Math.min(300, this.uploadStatus()?.inspection?.result?.durationSeconds ?? 300));
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
  constructor() {
    this.restoreReferences();
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
    });
    void this.reload();
  }
  private storageKey(): string {
    return `ac:resume:${this.session.user()?.id}:${this.id}`;
  }
  private remember(): void {
    try {
      sessionStorage.setItem(
        this.storageKey(),
        JSON.stringify({ uploadId: this.uploadId, pipelineId: this.pipelineId, pipelineUploadId: this.pipelineUploadId }),
      );
    } catch { /* The workflow remains usable when this browser blocks session storage. */ }
  }
  private restoreReferences(): void {
    try {
      const stored = sessionStorage.getItem(this.storageKey());
      if (!stored) return;
      const refs: { uploadId?: string; pipelineId?: string; pipelineUploadId?: string } = JSON.parse(stored);
      this.uploadId = refs.uploadId ?? "";
      this.pipelineId = refs.pipelineId ?? "";
      this.pipelineUploadId = refs.pipelineUploadId ?? "";
    } catch {
      /* Ignore an invalid or unavailable local resume reference. */
    }
  }
  private switchProject(id: string): void {
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
    this.uploadStatus.set(null);
    this.pipeline.set(null);
    this.busy.set(false);
    this.uploading.set(false);
    this.inspecting.set(false);
    this.pollingPipeline.set(false);
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
    this.restoreReferences();
    void this.reload();
  }
  canEdit(): boolean {
    if (!this.workspace.loaded()) return false;
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
  usageStateLabel(state: Schema<"PipelineStatusDto">["usageState"]): string {
    return ({ legacy: "Trabajo anterior", pending: "Consumo pendiente", accepted: "Reserva aceptada", rejected: "Reserva rechazada" } as const)[state];
  }
  eventStateLabel(state: string): string {
    return ({ queued: "En cola", audio: "Preparando audio", analysis: "Transcribiendo", render: "Creando el clip", stopping: "Cancelación solicitada", succeeded: "Completado", failed: "Error", cancelled: "Cancelado" } as Record<string, string>)[state] ?? state;
  }
  choose(event: Event): void {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
  }
  async reload(): Promise<void> {
    const generation = this.projectGeneration;
    const projectId = this.id;
    await this.run(async () => {
      this.loadNotice.set("");
      const [projectResult, editsResult] = await Promise.allSettled([
        this.api.get(projectId),
        this.api.edits(projectId),
      ]);
      if (!this.isCurrentProject(generation)) return;
      if (projectResult.status === "rejected") throw projectResult.reason;
      this.project.set(projectResult.value);
      if (editsResult.status === "fulfilled") {
        this.edits.set(editsResult.value.items);
      } else {
        this.loadNotice.set(
          `El proyecto está disponible, pero no se pudieron cargar sus revisiones: ${errorMessage(editsResult.reason)}`,
        );
      }
    });
    if (!this.isCurrentProject(generation)) return;
    if (this.uploadId) await this.inspect();
    if (this.pipelineId) await this.pollPipeline();
  }
  async upload(): Promise<void> {
    if (!this.file || this.busy()) return;
    const generation = this.projectGeneration;
    const file = this.file;
    this.uploading.set(true);
    await this.run(async () => {
      const status = await this.api.uploadFile(
        this.id,
        file,
        (stage) => { if (this.isCurrentProject(generation)) this.message.set(stage); },
        (id) => {
          if (!this.isCurrentProject(generation)) return;
          this.selectUpload(id);
          this.remember();
        },
      );
      if (!this.isCurrentProject(generation)) return;
      this.uploadStatus.set(status);
      this.message.set(
        "Carga confirmada. Esperando el resultado real de la inspección.",
      );
    });
    if (!this.isCurrentProject(generation)) return;
    this.uploading.set(false);
    if (this.uploadStatus()) await this.inspect();
  }
  async inspect(): Promise<void> {
    clearTimeout(this.inspectionTimer);
    if (!this.uploadId) return;
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
      this.uploadError.set(errorMessage(error));
    } finally {
      if (generation === this.uploadGeneration && this.isCurrentProject(projectGeneration)) this.inspecting.set(false);
    }
  }
  async abortUpload(): Promise<void> {
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
  private validateInterval(): void {
    if (
      !Number.isFinite(this.startSeconds) ||
      !Number.isFinite(this.endSeconds) ||
      this.startSeconds < 0 ||
      this.endSeconds - this.startSeconds < 0.1 ||
      this.endSeconds - this.startSeconds > 120 ||
      this.endSeconds > this.sourceDurationSeconds()
    )
      throw new Error(`El intervalo debe durar entre 0,1 y 120 segundos y quedar dentro de la fuente (${this.sourceDurationSeconds()} s).`);
  }
  async startPipeline(): Promise<void> {
    const generation = this.projectGeneration;
    await this.run(async () => {
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
    if (!this.pipelineId) return;
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
      this.pipelineError.set(errorMessage(error));
    } finally {
      if (generation === this.pipelineGeneration && this.isCurrentProject(projectGeneration)) this.pollingPipeline.set(false);
    }
  }
  async cancelPipeline(): Promise<void> {
    const generation = this.projectGeneration;
    const id = this.pipelineId.trim();
    await this.run(async () => {
      await this.api.cancelPipeline(id);
      if (!this.isCurrentProject(generation) || this.pipelineId.trim() !== id) return;
      await this.pollPipeline();
    });
  }
  async downloadPipeline(artifact: string): Promise<void> {
    const id = this.pipelineId.trim();
    await this.run(async () => {
      const result = await this.api.pipelineDownload(id, artifact);
      await downloadPrivateArtifact(result.url, `autoclipper-${id}.${artifact === 'video' ? 'mp4' : artifact}`);
    });
  }
  async createEdit(): Promise<void> {
    const generation = this.projectGeneration;
    await this.run(async () => {
      if (!this.inspected()) throw new Error('Consulta una carga inspeccionada de este proyecto antes de crear el borrador.');
      const uploadId = this.uploadId.trim();
      this.validateInterval();
      const analysisId =
        this.hasLinkedTranscript()
          ? this.pipeline()?.analysisId
          : null;
      const body: Schema<"CreateEditDto"> = {
        name: `Clip ${this.startSeconds}–${this.endSeconds}s`,
        spec: {
          version: 1,
          kind: "clip",
          startSeconds: this.startSeconds,
          endSeconds: this.endSeconds,
          aspect: this.aspect,
          subtitles: analysisId
            ? { source: "transcript", analysisId }
            : { source: "none" },
        },
      };
      const serialized = JSON.stringify({ uploadId, body });
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
      this.editKey = "";
      this.editBody = "";
      await this.router.navigate(["/app/edits", result.id]);
    });
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    const generation = this.projectGeneration;
    this.busy.set(true);
    this.error.set("");
    this.loadNotice.set("");
    try {
      await action();
    } catch (error) {
      if (this.isCurrentProject(generation)) this.error.set(errorMessage(error));
    } finally {
      if (this.isCurrentProject(generation)) this.busy.set(false);
    }
  }
  private isCurrentProject(generation: number): boolean {
    return !this.disposed && generation === this.projectGeneration;
  }
}
