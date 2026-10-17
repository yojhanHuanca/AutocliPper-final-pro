import { DESIGN_MODE } from "../../../core/config/design-mode.token";
import { EditorApi } from "../data-access/editor-api.service";
import { CollaborationApi } from "../../collaboration/data-access/collaboration-api.service";
import { HttpErrorResponse } from "@angular/common/http";
import { Injectable, DestroyRef, computed, inject, signal } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import type { Response } from "../../../core/contracts/api-types";
import type { Schema } from "../../../core/contracts/api-types";
import { errorMessage } from "../../../core/http/api-error";
import { captionCueIssues, validateCaptionCues } from '../models/caption-cues';
import { downloadPrivateArtifact } from '../../../core/http/artifact-download';
import { EDITOR_DISCARD_CONFIRMATION } from './discard-confirmation.token';
@Injectable()
export class EditorState {
  private readonly api = inject(EditorApi);
  private readonly collaboration = inject(CollaborationApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  private readonly discardConfirmation = inject(EDITOR_DISCARD_CONFIRMATION);
  readonly design = inject(DESIGN_MODE);
  readonly id = this.route.snapshot.paramMap.get("id") ?? "";
  readonly draft = signal<Schema<"EditorDraftDto"> | null>(null);
  readonly project = signal<Schema<"ProjectResponseDto"> | null>(null);
  readonly review = signal<Schema<"ReviewHistoryDto"> | null>(null);
  readonly history = signal<Schema<"EditorRevisionSummaryDto">[]>([]);
  readonly nextVersion = signal<number | null>(null);
  readonly comments = signal<Schema<"EditorCommentDto">[]>([]);
  readonly nextComment = signal<string | null>(null);
  readonly exports = signal<Schema<"EditorExportDto">[]>([]);
  readonly tab = signal("composition");
  readonly busy = signal(false);
  readonly error = signal("");
  readonly loadNotice = signal("");
  readonly conflict = signal(false);
  readonly message = signal("");
  readonly previewUrl = signal("");
  readonly previewVersion = signal<string | number>("");
  private readonly formVersion = signal(0);
  readonly timeline = computed(() => {
    this.formVersion();
    return { startSeconds: this.spec.startSeconds, endSeconds: this.spec.endSeconds, captionSource: this.captionSource };
  });
  touchForm(): void { this.formVersion.update(version => version + 1); }
  readonly captionIssues = computed(() => {
    this.formVersion();
    return this.captionSource === 'user'
      ? this.cues.map(cue => captionCueIssues(cue, this.spec.startSeconds, this.spec.endSeconds)) : [];
  });
  readonly invalidCaptions = computed(() => {
    this.formVersion();
    return this.captionSource === 'user' && (!this.cues.length || this.cues.length > 200 || this.captionIssues().some(issue => issue.times || issue.text));
  });
  readonly tabs = [
    { id: "composition", label: "Composición", icon: "settings" },
    { id: "captions", label: "Subtítulos", icon: "captions" },
    { id: "history", label: "Historial", icon: "clock" },
    { id: "review", label: "Revisión", icon: "users" },
    { id: "exports", label: "Exportaciones", icon: "download" },
  ];
  spec: Schema<"EditorSpecDto"> = {
    version: 1,
    kind: "clip",
    startSeconds: 0,
    endSeconds: 30,
    aspect: "vertical",
  };
  cropX = 0.5;
  cropY = 0.5;
  splitEnabled = false;
  secondaryUploadId = "";
  primaryRatio = 0.5;
  secondaryStart = 0;
  splitLayout: Schema<"SplitScreenDto">["layout"] = "stacked";
  shortInput: Schema<"SplitScreenDto">["shortInput"] = "freeze";
  splitAudio: Schema<"SplitScreenDto">["audio"] = "primary";
  captionSource = "none";
  analysisId = "";
  cues: Schema<'SubtitleCueDto'>[] = [];
  captionTemplate: Schema<"SubtitleStyleDto">["template"] = "clean";
  captionPosition: "top" | "bottom" = "bottom";
  fontSize = 24;
  commentText = "";
  commentTime = 0;
  readonly replyTarget = signal<Schema<"EditorCommentDto"> | null>(null);
  private etag: string | null = null;
  private initialForm = "";
  private renderKey = "";
  private commentKey = "";
  private commentBody = "";
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor() {
    this.destroy.onDestroy(() => {
      this.disposed = true;
      clearTimeout(this.timer);
    });
    if (!this.design) void this.reload();
  }
  private snapshot(): string {
    return JSON.stringify([
      this.spec,
      this.cropX,
      this.cropY,
      this.splitEnabled,
      this.secondaryUploadId,
      this.primaryRatio,
      this.secondaryStart,
      this.splitLayout,
      this.shortInput,
      this.splitAudio,
      this.captionSource,
      this.analysisId,
      this.cues,
      this.captionTemplate,
      this.captionPosition,
      this.fontSize,
    ]);
  }
  dirty(): boolean {
    this.formVersion();
    return !!this.initialForm && this.snapshot() !== this.initialForm;
  }
  confirmDiscard(): boolean {
    return !this.dirty() || this.discardConfirmation();
  }
  addCue(): void {
    if (this.design || this.cues.length >= 200) return;
    const startSeconds = this.cues.at(-1)?.endSeconds ?? this.spec.startSeconds;
    if (startSeconds >= this.spec.endSeconds) { this.message.set('Ajusta el final de la última frase para dejar espacio a la siguiente.'); return; }
    this.cues = [...this.cues, { startSeconds, endSeconds: Math.min(startSeconds + 3, this.spec.endSeconds), text: '' }];
    this.touchForm();
  }
  removeCue(index: number): void {
    if (!this.design) { this.cues = this.cues.filter((_cue, i) => i !== index); this.touchForm(); }
  }
  private accept(
    draft: Schema<"EditorDraftDto">,
    etag: string | null = null,
  ): void {
    this.draft.set(draft);
    this.etag = etag;
    this.spec = structuredClone(draft.revision.spec);
    this.cropX = this.spec.framing?.x ?? 0.5;
    this.cropY = this.spec.framing?.y ?? 0.5;
    const split = this.spec.splitScreen;
    this.splitEnabled = !!split;
    this.secondaryUploadId = split?.secondaryUploadId ?? "";
    this.primaryRatio = split?.primaryRatio ?? 0.5;
    this.secondaryStart = split?.startSeconds ?? 0;
    this.splitLayout = split?.layout ?? "stacked";
    this.shortInput = split?.shortInput ?? "freeze";
    this.splitAudio = split?.audio ?? "primary";
    const captions = this.spec.subtitles;
    this.captionSource = captions?.source ?? "none";
    this.analysisId =
      captions?.source === "transcript" ? captions.analysisId : "";
    this.cues = captions?.source === 'user' ? structuredClone(captions.cues) : [];
    const style =
      captions && captions.source !== "none" ? captions.style : undefined;
    this.captionTemplate = style?.template ?? "clean";
    this.captionPosition = style?.position ?? "bottom";
    this.fontSize = style?.fontSize ?? 24;
    this.initialForm = this.snapshot();
    this.touchForm();
  }
  async reload(): Promise<void> {
    if (this.busy() || !this.confirmDiscard()) return;
    await this.run(async () => {
      const result = await this.api.edit(this.id);
      this.accept(result.draft, result.etag);
      const labels = ["metadatos del proyecto", "historial", "comentarios", "exportaciones", "revisión"];
      const results = await Promise.allSettled([
        this.api.project(result.draft.projectId),
        this.loadHistory(),
        this.loadComments(),
        this.loadExports(),
        this.loadReview(),
      ]);
      if (results[0].status === "fulfilled") this.project.set(results[0].value);
      const unavailable = results.flatMap((result, index) =>
        result.status === "rejected" ||
        (index === 3 && result.status === "fulfilled" && result.value === false)
          ? [labels[index]]
          : [],
      );
      if (unavailable.length)
        this.loadNotice.set(
          `El borrador está disponible; no se pudo cargar ${unavailable.join(", ")}. Puedes volver a consultar la sección.`,
        );
    });
  }
  private buildSpec(): Schema<"EditorSpecDto"> {
    if (
      !Number.isFinite(this.spec.startSeconds) ||
      !Number.isFinite(this.spec.endSeconds) ||
      this.spec.startSeconds < 0 ||
      this.spec.endSeconds - this.spec.startSeconds < 0.1 ||
      this.spec.endSeconds - this.spec.startSeconds > 120
    )
      throw new Error("El intervalo debe durar entre 0,1 y 120 segundos.");
    const result: Schema<"EditorSpecDto"> = {
      ...this.spec,
      framing: { x: Number(this.cropX), y: Number(this.cropY) },
    };
    delete result.splitScreen;
    if (this.splitEnabled)
      result.splitScreen = {
        ...(this.spec.splitScreen ?? {}),
        secondaryUploadId: this.secondaryUploadId.trim(),
        layout: this.splitLayout,
        primaryRatio: Number(this.primaryRatio),
        startSeconds: this.secondaryStart,
        shortInput: this.shortInput,
        audio: this.splitAudio,
      };
    const style: Schema<"SubtitleStyleDto"> = {
      template: this.captionTemplate,
      position: this.captionPosition,
      fontSize: this.fontSize,
    };
    result.subtitles =
      this.captionSource === "transcript"
        ? { source: "transcript", analysisId: this.analysisId.trim(), style }
        : this.captionSource === "user"
          ? {
              source: "user",
              cues: validateCaptionCues(this.cues, this.spec.startSeconds, this.spec.endSeconds),
              style,
            }
          : { source: "none" };
    return result;
  }
  async save(): Promise<void> {
    await this.run(async () => {
      const draft = this.draft();
      if (!draft) return;
      const body: Schema<"UpdateEditDto"> = {
        version: draft.version,
        spec: this.buildSpec(),
      };
      const saved = await this.api.save(this.id, body, this.etag ?? undefined);
      this.accept(saved.draft, saved.etag);
      this.message.set(`Revisión ${saved.draft.version} guardada.`);
      this.renderKey = "";
      await this.refreshRevisionMetadata();
    });
  }
  async loadHistory(append = false): Promise<void> {
    if (this.design) return;
    const result = await this.api.history(
      this.id,
      append ? this.nextVersion() : null,
    );
    this.history.set(
      append ? [...this.history(), ...result.items] : result.items,
    );
    this.nextVersion.set(result.nextBeforeVersion);
  }
  async moreHistory(): Promise<void> {
    await this.run(() => this.loadHistory(true));
  }
  async restore(version: number): Promise<void> {
    await this.run(async () => {
      const draft = this.draft();
      if (!draft || this.dirty()) return;
      const restored = await this.api.restore(
        this.id,
        { version: draft.version, revisionVersion: version },
        this.etag ?? undefined,
      );
      this.accept(restored.draft, restored.etag);
      this.message.set(
        `Revisión ${version} recuperada como revisión ${restored.draft.version}.`,
      );
      await this.refreshRevisionMetadata();
    });
  }
  private async refreshRevisionMetadata(): Promise<void> {
    const [history, review] = await Promise.allSettled([
      this.loadHistory(),
      this.loadReview(),
    ]);
    const unavailable = [
      ...(history.status === "rejected" ? ["historial"] : []),
      ...(review.status === "rejected" ? ["estado de revisión"] : []),
    ];
    if (unavailable.length)
      this.loadNotice.set(
        `El borrador se actualizó, pero no se pudo actualizar ${unavailable.join(" y ")}. Reintenta la carga para sincronizarlo.`,
      );
  }
  async loadReview(): Promise<void> {
    if (!this.design) this.review.set(await this.collaboration.review(this.id));
  }
  async requestReview(): Promise<void> {
    await this.reviewAction("review");
  }
  async returnReview(): Promise<void> {
    await this.reviewAction("return");
  }
  async approve(): Promise<void> {
    await this.reviewAction("approvals");
  }
  private async reviewAction(path: "review" | "return" | "approvals"): Promise<void> {
    await this.run(async () => {
      const review = this.review();
      const draft = this.draft();
      if (!review || !draft || this.dirty()) return;
      const body = { version: draft.version, reviewVersion: review.reviewVersion };
      const next = path === "return"
        ? await this.collaboration.returnReview(this.id, body)
        : path === "approvals"
          ? await this.collaboration.approve(this.id, body)
          : await this.collaboration.requestReview(this.id, body);
      this.review.update((current) => current ? { ...current, ...next } : null);
      this.message.set(path === "return" ? "La revisión volvió al editor." : path === "approvals" ? "Revisión aprobada." : "Solicitud de revisión enviada.");
      const refreshed = await Promise.allSettled([this.loadReview()]);
      if (refreshed[0].status === "rejected")
        this.loadNotice.set("El cambio se realizó, pero no se pudo actualizar el historial de aprobaciones.");
    });
  }
  replyTo(item: Schema<"EditorCommentDto">): void {
    if (item.deletedAt) return;
    this.replyTarget.set(item);
    this.commentTime = item.timeSeconds;
    this.message.set("Responde con una nueva observación en la misma marca temporal.");
  }
  clearReply(): void { this.replyTarget.set(null); }
  async loadComments(append = false): Promise<void> {
    if (this.design) return;
    const result = await this.collaboration.comments(this.id, {
      beforeId: append ? this.nextComment() : null,
    });
    this.comments.set(
      append ? [...this.comments(), ...result.items] : result.items,
    );
    this.nextComment.set(result.nextBeforeId);
  }
  async moreComments(): Promise<void> {
    await this.run(() => this.loadComments(true));
  }
  async comment(): Promise<void> {
    await this.run(async () => {
      const draft = this.draft();
      if (!draft) return;
      const body: Schema<"CreateCommentDto"> = {
        revisionVersion: draft.version,
        timeSeconds: this.commentTime,
        text: this.commentText.trim(),
      };
      const serialized = JSON.stringify(body);
      if (serialized !== this.commentBody) {
        this.commentBody = serialized;
        this.commentKey = crypto.randomUUID();
      }
      const created = await this.collaboration.createComment(this.id, body, this.commentKey);
      this.comments.update((items) => [created, ...items.filter((item) => item.id !== created.id)]);
      this.commentText = "";
      this.commentKey = "";
      this.commentBody = "";
      this.replyTarget.set(null);
      this.message.set("Comentario añadido a esta revisión.");
      try { await this.loadComments(); }
      catch { this.loadNotice.set("El comentario se guardó, pero no se pudo actualizar la lista. Vuelve a cargar comentarios."); }
    });
  }
  async deleteComment(item: Schema<"EditorCommentDto">): Promise<void> {
    if (item.deletedAt) return;
    await this.run(async () => {
      const deleted = await this.collaboration.deleteComment(this.id, item.id, { version: item.version });
      this.comments.update((items) => items.map((comment) => comment.id === deleted.id ? deleted : comment));
      this.message.set("Comentario retirado.");
      try { await this.loadComments(); }
      catch { this.loadNotice.set("El comentario se retiró, pero no se pudo actualizar la lista."); }
    });
  }
  async loadExports(): Promise<boolean> {
    if (this.design) return true;
    clearTimeout(this.timer);
    try {
      const result = await this.api.exports(this.id);
      this.exports.set(result.items);
      if (
        !this.disposed &&
        result.items.some((e) => ["queued", "running"].includes(e.status))
      )
        this.timer = setTimeout(() => void this.loadExports(), 4000);
      return true;
    } catch (error) {
      this.loadNotice.set(
        `No se pudieron cargar las exportaciones: ${errorMessage(error)}`,
      );
      return false;
    }
  }
  async render(): Promise<void> {
    await this.run(async () => {
      const draft = this.draft();
      if (!draft || this.dirty()) return;
      this.renderKey ||= crypto.randomUUID();
      await this.api.render(this.id, draft.version, this.renderKey);
      this.renderKey = "";
      this.tab.set("exports");
      await this.loadExports();
      this.message.set("Exportación solicitada para la revisión guardada.");
    });
  }
  async cancelRender(id: string): Promise<void> {
    await this.run(async () => {
      await this.api.cancelRender(id);
      await this.loadExports();
    });
  }
  revisionLabel(id: string | undefined): string {
    return id
      ? String(this.history().find((r) => r.id === id)?.version ?? id)
      : "No informada";
  }
  async preview(item: Schema<"EditorExportDto">): Promise<void> {
    await this.run(async () => {
      const result = await this.api.download(item.id, "video");
      this.safeUrl(result.url);
      this.previewUrl.set(result.url);
      this.previewVersion.set(this.revisionLabel(item.editorRevisionId));
      this.message.set(
        "Reproduciendo exportación guardada. Si el enlace vence, selecciona Reproducir de nuevo.",
      );
    });
  }
  async download(id: string, kind: string): Promise<void> {
    await this.run(async () => {
      const result = await this.api.download(id, kind);
      await downloadPrivateArtifact(result.url, `autoclipper-${id}.${kind === 'video' ? 'mp4' : kind}`);
    });
  }
  private safeUrl(value: string): string {
    const parsed = new URL(value);
    if (!["https:", "http:"].includes(parsed.protocol))
      throw new Error("El servidor devolvió una URL inválida.");
    return parsed.href;
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.design || this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    this.loadNotice.set("");
    this.conflict.set(false);
    this.message.set("");
    try {
      await action();
    } catch (error) {
      this.error.set(errorMessage(error));
      this.conflict.set(
        error instanceof HttpErrorResponse && error.status === 412,
      );
    } finally {
      this.busy.set(false);
    }
  }
}
