import { DESIGN_MODE } from "../../../core/config/design-mode.token";
import { ProjectsApi } from "../data-access/projects-api.service";
import { downloadPrivateArtifact } from '../../../core/http/artifact-download';
import { WorkspaceStore } from "../../workspaces/data-access/workspace.store";
import {
  ViewEncapsulation,
  Component,
  DestroyRef,
  inject,
  signal,
} from "@angular/core";
import { DatePipe, DecimalPipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
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
  readonly id = this.route.snapshot.paramMap.get("id") ?? "";
  readonly project = signal<Schema<"ProjectResponseDto"> | null>(null);
  readonly edits = signal<EditList["items"]>([]);
  readonly uploadStatus = signal<Schema<"UploadStatusDto"> | null>(null);
  readonly pipeline = signal<Schema<"PipelineStatusDto"> | null>(null);
  readonly busy = signal(false);
  readonly uploading = signal(false);
  readonly error = signal("");
  readonly loadNotice = signal("");
  readonly message = signal("");
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
  constructor() {
    const stored = sessionStorage.getItem(this.storageKey());
    if (stored) {
      try {
        const refs: { uploadId?: string; pipelineId?: string; pipelineUploadId?: string } =
          JSON.parse(stored);
        this.uploadId = refs.uploadId ?? "";
        this.pipelineId = refs.pipelineId ?? "";
        this.pipelineUploadId = refs.pipelineUploadId ?? '';
      } catch {
        /* Ignore an invalid local resume reference. */
      }
    }
    this.destroy.onDestroy(() => {
      this.disposed = true;
      clearTimeout(this.timer);
      clearTimeout(this.inspectionTimer);
    });
    void this.reload();
  }
  private storageKey(): string {
    return `ac:resume:${this.session.user()?.id}:${this.id}`;
  }
  private remember(): void {
    sessionStorage.setItem(
      this.storageKey(),
      JSON.stringify({ uploadId: this.uploadId, pipelineId: this.pipelineId, pipelineUploadId: this.pipelineUploadId }),
    );
  }
  canEdit(): boolean {
    return ["owner", "admin", "editor"].includes(
      this.workspace
        .workspaces()
        .find((w) => w.id === this.project()?.workspaceId)?.role ?? "",
    );
  }
  inspected(): boolean {
    const status = this.uploadStatus();
    return status?.id === this.uploadId.trim() && status?.projectId === this.id && status?.inspection?.status === 'succeeded';
  }
  selectUpload(id: string): void {
    this.uploadId = id;
    this.uploadGeneration++;
    clearTimeout(this.inspectionTimer);
    this.uploadStatus.set(null);
  }
  selectPipeline(id: string): void {
    this.pipelineId = id;
    this.pipelineUploadId = '';
    this.pipelineGeneration++;
    clearTimeout(this.timer);
    this.pipeline.set(null);
  }
  hasLinkedTranscript(): boolean {
    const task = this.pipeline();
    return !!task?.analysisId && task.status === 'succeeded' && task.id === this.pipelineId.trim() && this.pipelineUploadId === this.uploadId.trim();
  }
  choose(event: Event): void {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
  }
  async reload(): Promise<void> {
    await this.run(async () => {
      this.loadNotice.set("");
      const [projectResult, editsResult] = await Promise.allSettled([
        this.api.get(this.id),
        this.api.edits(this.id),
      ]);
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
    if (this.uploadId) await this.inspect();
    if (this.pipelineId) await this.pollPipeline();
  }
  async upload(): Promise<void> {
    if (!this.file || this.busy()) return;
    this.uploading.set(true);
    await this.run(async () => {
      const status = await this.api.uploadFile(
        this.id,
        this.file!,
        (stage) => this.message.set(stage),
        (id) => {
          this.selectUpload(id);
          this.remember();
        },
      );
      this.uploadStatus.set(status);
      this.message.set(
        "Carga confirmada. Esperando el resultado real de la inspección.",
      );
    });
    this.uploading.set(false);
    if (this.uploadStatus()) await this.inspect();
  }
  async inspect(): Promise<void> {
    clearTimeout(this.inspectionTimer);
    if (!this.uploadId) return;
    const id = this.uploadId.trim(), generation = ++this.uploadGeneration;
    try {
      const status = await this.api.upload(id);
      if (generation !== this.uploadGeneration || this.disposed) return;
      if (status.projectId !== this.id)
        throw new Error("La carga consultada pertenece a otro proyecto.");
      this.uploadStatus.set(status);
      this.remember();
      if (
        !this.disposed &&
        status.state === "confirmed" &&
        !["succeeded", "failed"].includes(status.inspection?.status ?? "")
      )
        this.inspectionTimer = setTimeout(() => void this.inspect(), 4000);
    } catch (error) {
      if (generation !== this.uploadGeneration || this.disposed) return;
      this.uploadStatus.set(null);
      this.error.set(errorMessage(error));
    }
  }
  async abortUpload(): Promise<void> {
    await this.run(async () => {
      await this.api.abortUpload(this.uploadId);
      await this.inspect();
    });
  }
  private validateInterval(): void {
    if (
      !Number.isFinite(this.startSeconds) ||
      !Number.isFinite(this.endSeconds) ||
      this.startSeconds < 0 ||
      this.endSeconds - this.startSeconds < 0.1 ||
      this.endSeconds - this.startSeconds > 120
    )
      throw new Error("El intervalo debe durar entre 0,1 y 120 segundos.");
  }
  async startPipeline(): Promise<void> {
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
    const id = this.pipelineId.trim(), generation = ++this.pipelineGeneration;
    try {
      const task = await this.api.pipeline(id);
      if (generation !== this.pipelineGeneration || this.disposed) return;
      this.pipeline.set(task);
      this.remember();
      if (
        !this.disposed &&
        !["succeeded", "failed", "cancelled"].includes(task.status)
      )
        this.timer = setTimeout(() => void this.pollPipeline(), 4000);
    } catch (error) {
      if (generation !== this.pipelineGeneration || this.disposed) return;
      this.pipeline.set(null);
      this.error.set(errorMessage(error));
    }
  }
  async cancelPipeline(): Promise<void> {
    await this.run(async () => {
      await this.api.cancelPipeline(this.pipelineId);
      await this.pollPipeline();
    });
  }
  async downloadPipeline(artifact: string): Promise<void> {
    await this.run(async () => {
      const result = await this.api.pipelineDownload(this.pipelineId, artifact);
      await downloadPrivateArtifact(result.url, `autoclipper-${this.pipelineId}.${artifact === 'video' ? 'mp4' : artifact}`);
    });
  }
  async createEdit(): Promise<void> {
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
      this.editKey = "";
      this.editBody = "";
      await this.router.navigate(["/app/edits", result.id]);
    });
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    this.loadNotice.set("");
    try {
      await action();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
