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
  readonly message = signal("");
  file: File | null = null;
  uploadId = "";
  pipelineId = "";
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
        const refs: { uploadId?: string; pipelineId?: string } =
          JSON.parse(stored);
        this.uploadId = refs.uploadId ?? "";
        this.pipelineId = refs.pipelineId ?? "";
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
      JSON.stringify({ uploadId: this.uploadId, pipelineId: this.pipelineId }),
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
    return this.uploadStatus()?.inspection?.status === "succeeded";
  }
  choose(event: Event): void {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
  }
  async reload(): Promise<void> {
    await this.run(async () => {
      const [project, edits] = await Promise.all([
        this.api.get(this.id),
        this.api.edits(this.id),
      ]);
      this.project.set(project);
      this.edits.set(edits.items);
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
          this.uploadId = id;
          this.uploadStatus.set(null);
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
    try {
      const status = await this.api.upload(this.uploadId);
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
      const serialized = JSON.stringify(body);
      if (serialized !== this.pipelineBody) {
        this.pipelineBody = serialized;
        this.pipelineKey = crypto.randomUUID();
      }
      const result = await this.api.createPipeline(
        this.uploadId,
        body,
        this.pipelineKey,
      );
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
    try {
      const task = await this.api.pipeline(this.pipelineId);
      this.pipeline.set(task);
      this.remember();
      if (
        !this.disposed &&
        !["succeeded", "failed", "cancelled"].includes(task.status)
      )
        this.timer = setTimeout(() => void this.pollPipeline(), 4000);
    } catch (error) {
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
      this.validateInterval();
      const analysisId =
        this.pipeline()?.status === "succeeded"
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
      const serialized = JSON.stringify(body);
      if (serialized !== this.editBody) {
        this.editBody = serialized;
        this.editKey = crypto.randomUUID();
      }
      const result = await this.api.createEdit(
        this.uploadId,
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
    try {
      await action();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
