import { DESIGN_MODE } from "../../../core/config/design-mode.token";
import { EditorApi } from "../data-access/editor-api.service";
import { CollaborationApi } from "../../collaboration/data-access/collaboration-api.service";
import { HttpErrorResponse } from "@angular/common/http";
import { Injectable, DestroyRef, computed, inject, signal } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import type { Response } from "../../../core/contracts/api-types";
import type { Schema } from "../../../core/contracts/api-types";
import { errorMessage } from "../../../core/http/api-error";
import { captionListIssues, validateCaptionCues } from '../models/caption-cues';
import { copyTranscriptCues, layoutCaptionCues } from '../models/caption-timeline';
import { playbackWindow, renderedCaptionCues } from '../models/caption-playback';
import { EDITOR_ARTIFACT_DOWNLOAD } from './editor-artifact-download.token';
import { EDITOR_DISCARD_CONFIRMATION } from './discard-confirmation.token';
import { EditorNavigationService } from "./editor-navigation.service";
import { WorkspaceStore } from "../../workspaces/data-access/workspace.store";
import { SessionStore } from "../../../core/auth/session.store";
import { ProjectsApi } from "../../projects/data-access/projects-api.service";
@Injectable()
export class EditorState {
  private readonly api = inject(EditorApi);
  private readonly artifactDownload = inject(EDITOR_ARTIFACT_DOWNLOAD);
  private readonly collaboration = inject(CollaborationApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  private readonly discardConfirmation = inject(EDITOR_DISCARD_CONFIRMATION);
  private readonly editorNavigation = inject(EditorNavigationService);
  private readonly workspaceStore = inject(WorkspaceStore);
  private readonly sessionStore = inject(SessionStore);
  private readonly projectsApi = inject(ProjectsApi);
  readonly design = inject(DESIGN_MODE);
  private readonly activeId = signal(this.route.snapshot.paramMap.get("id") ?? "");
  get id(): string { return this.activeId(); }
  readonly draft = signal<Schema<"EditorDraftDto"> | null>(null);
  readonly project = signal<Schema<"ProjectResponseDto"> | null>(null);
  readonly sourceDuration = signal<number | null>(null);
  readonly transcriptSegments = signal<Schema<"TranscriptSegmentDto">[]>([]);
  readonly transcriptLoading = signal(false);
  readonly transcriptError = signal("");
  private transcriptGeneration = 0;
  readonly cueSelection = signal<{ source: string; index: number } | null>(null);
  readonly captionActionError = signal("");
  readonly collaborationRole = computed(() => {
    const project = this.project();
    if (!project || !this.workspaceStore.loaded()) return "loading" as const;
    return this.workspaceStore.workspaces().find((workspace) => workspace.id === project.workspaceId)?.role ?? "unavailable" as const;
  });
  readonly canEditCollaboration = computed(() => ["owner", "admin", "editor"].includes(this.collaborationRole()));
  readonly canChangeCaptions = computed(() => !this.design && !this.busy() && !!this.draft() && this.canEditCollaboration());
  readonly canAdminCollaboration = computed(() => ["owner", "admin"].includes(this.collaborationRole()));
  readonly exportsLoaded = signal(false);
  readonly review = signal<Schema<"ReviewHistoryDto"> | null>(null);
  readonly history = signal<Schema<"EditorRevisionSummaryDto">[]>([]);
  readonly nextVersion = signal<number | null>(null);
  readonly comments = signal<Schema<"EditorCommentDto">[]>([]);
  readonly nextComment = signal<string | null>(null);
  readonly exports = signal<Schema<"EditorExportDto">[]>([]);
  readonly exportsError = signal("");
  readonly exportsLoading = signal(false);
  private exportsGeneration = 0;
  readonly renderReceipt = signal<{ id: string; revisionId: string; version: number } | null>(null);
  private receiptLookups = 0;
  readonly exportPhase = signal<'idle' | 'saving' | 'requesting'>('idle');
  readonly currentRevisionExports = computed(() => this.exports().filter(item => !!item.editorRevisionId && item.editorRevisionId === this.draft()?.revision.id));
  readonly currentRenderPending = computed(() => this.currentRevisionExports().some(item => item.status === 'queued' || item.status === 'running') ||
    (this.renderReceipt()?.revisionId === this.draft()?.revision.id && !!this.renderReceipt() && !this.exports().some(item => item.id === this.renderReceipt()?.id)));
  readonly receiptExport = computed(() => this.exports().find(item => item.id === this.renderReceipt()?.id) ?? null);
  readonly tab = signal("composition");
  readonly busy = signal(false);
  readonly error = signal("");
  readonly loadNotice = signal("");
  readonly conflict = signal(false);
  readonly message = signal("");
  readonly previewUrl = signal("");
  readonly previewVersion = signal<string | number>("");
  readonly previewSession = signal<{ token: number; exportId: string; revisionId: string | undefined; url: string } | null>(null);
  private previewGeneration = 0;
  readonly previewDuration = signal<number | null>(null);
  readonly previewTime = signal<number | null>(null);
  readonly previewError = signal('');
  readonly previewSeek = signal<{ token: number; sequence: number; seconds: number } | null>(null);
  private seekSequence = 0;
  readonly previewSyncNotice = computed(() => {
    const session = this.previewSession();
    if (!session) return '';
    if (this.previewError()) return this.previewError();
    if (this.dirty()) return 'Hay cambios sin guardar. Guarda y exporta esta revisión para sincronizar sus frases.';
    if (!session.revisionId || session.revisionId !== this.draft()?.revision.id)
      return 'Este render pertenece a otra revisión o no informa su revisión. Sus tiempos no se vinculan al borrador actual.';
    if (this.previewDuration() === null) return 'Cargando los tiempos del video…';
    if (!playbackWindow(this.draft()?.revision.renderSpec, this.previewDuration()))
      return 'No se pudo comprobar el intervalo de este render. La sincronización de frases está desactivada.';
    return '';
  });
  readonly previewSyncReady = computed(() => !!this.previewSession() && !this.previewSyncNotice());
  readonly renderedCues = computed(() => this.previewSyncReady()
    ? renderedCaptionCues(this.captionEntries(), this.draft()?.revision.renderSpec, this.previewDuration()) : []);
  readonly playingCueIndices = computed(() => {
    const time = this.previewTime();
    return time === null ? [] : this.renderedCues().filter(cue => time >= cue.from && time < cue.to).map(cue => cue.index);
  });
  readonly selectedCueSeekTime = computed(() => this.renderedCues().find(cue => cue.index === this.selectedCue()?.index)?.from ?? null);
  readonly playbackPosition = computed(() => {
    const window = this.previewSyncReady() ? playbackWindow(this.draft()?.revision.renderSpec, this.previewDuration()) : null;
    const time = this.previewTime();
    return window && time !== null ? { sourceSeconds: window.start + Math.min(time, window.duration), percent: Math.min(100, time / (window.end - window.start) * 100) } : null;
  });
  private readonly formVersion = signal(0);
  readonly timeline = computed(() => {
    this.formVersion();
    return { startSeconds: this.spec.startSeconds, endSeconds: this.spec.endSeconds, captionSource: this.captionSource, sourceDuration: this.sourceDuration() };
  });
  readonly clipRangeUsable = computed(() => {
    const { startSeconds: start, endSeconds: end, sourceDuration: duration } = this.timeline();
    return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end - start >= 0.1 &&
      end - start <= 120 && end <= 14400 && (duration === null || end <= duration);
  });
  readonly captionEntries = computed(() => {
    this.formVersion();
    if (this.captionSource === 'user') return this.cues.map((cue, index) => ({ ...cue, index }));
    if (this.captionSource === 'transcript') return this.transcriptSegments()
      .map((cue, index) => ({ ...cue, index }))
      .filter(cue => cue.endSeconds > this.spec.startSeconds && cue.startSeconds < this.spec.endSeconds);
    return [];
  });
  readonly selectedCue = computed(() => {
    const selection = this.cueSelection();
    return selection?.source === this.timeline().captionSource
      ? this.captionEntries().find(cue => cue.index === selection.index) ?? null : null;
  });
  readonly selectedCuePosition = computed(() => this.captionEntries().findIndex(cue => cue.index === this.selectedCue()?.index));
  readonly selectedCueIssues = computed(() => this.selectedCue() && this.timeline().captionSource === 'user'
    ? this.captionIssues()[this.selectedCue()!.index] ?? { times: '', text: '' } : { times: '', text: '' });
  readonly timelineCues = computed(() => this.clipRangeUsable() ? layoutCaptionCues(this.captionEntries(), this.timeline().startSeconds, this.timeline().endSeconds) : []);
  readonly timelineCueRows = computed(() => Math.max(1, ...this.timelineCues().map(cue => cue.row + 1)));
  touchForm(): void { this.formVersion.update(version => version + 1); }
  setClipField(field: 'startSeconds' | 'endSeconds', value: number | null): void {
    if (!this.canChangeCaptions()) return;
    this.spec[field] = typeof value === 'number' ? value : Number.NaN;
    this.touchForm();
  }
  setTimelineStart(value: number): void {
    if (!this.canChangeCaptions() || !Number.isFinite(value)) return;
    const duration = this.sourceDuration();
    const lower = Math.max(0, this.spec.endSeconds - 120);
    const upper = Math.min(this.spec.endSeconds - 0.1, duration === null ? Number.POSITIVE_INFINITY : duration - 0.1);
    if (upper < lower && duration !== null && duration >= 0.1) {
      this.spec.startSeconds = Math.min(duration - 0.1, Math.max(0, Math.round(value * 10) / 10));
    } else if (upper >= lower) {
      this.spec.startSeconds = Math.min(upper, Math.max(lower, Math.round(value * 10) / 10));
    } else return;
    this.touchForm();
  }
  setTimelineEnd(value: number): void {
    if (!this.canChangeCaptions() || !Number.isFinite(value)) return;
    const duration = this.sourceDuration();
    const lower = this.spec.startSeconds + 0.1;
    const upper = Math.min(this.spec.startSeconds + 120, duration ?? Number.POSITIVE_INFINITY);
    if (upper < lower && duration !== null && duration >= 0.1) {
      this.spec.endSeconds = duration;
    } else if (upper >= lower) {
      this.spec.endSeconds = Math.min(upper, Math.max(lower, Math.round(value * 10) / 10));
    } else return;
    this.touchForm();
  }
  timelineStartMin(): number {
    const duration = this.sourceDuration();
    const minimum = Math.max(0, this.spec.endSeconds - 120);
    return duration === null ? minimum : Math.min(minimum, Math.max(0, duration - 0.1));
  }
  timelineStartMax(): number {
    const duration = this.sourceDuration();
    const minimum = this.timelineStartMin();
    const maximum = Math.min(this.spec.endSeconds - 0.1, duration === null ? Number.POSITIVE_INFINITY : duration - 0.1);
    return Math.max(minimum, maximum);
  }
  timelineEndMin(): number {
    const duration = this.sourceDuration();
    return duration === null ? this.spec.startSeconds + 0.1 : Math.min(this.spec.startSeconds + 0.1, duration);
  }
  timelineEndMax(): number {
    const duration = this.sourceDuration();
    return duration === null ? this.spec.startSeconds + 120 : Math.min(this.spec.startSeconds + 120, duration);
  }
  sourceRangeInvalid(): boolean {
    const duration = this.sourceDuration();
    return duration !== null && this.spec.endSeconds > duration;
  }
  readonly captionIssues = computed(() => {
    this.formVersion();
    return this.captionSource === 'user'
      ? captionListIssues(this.cues, this.spec.startSeconds, this.spec.endSeconds) : [];
  });
  readonly invalidCaptions = computed(() => {
    this.formVersion();
    return this.captionSource === 'user' && (!this.cues.length || this.cues.length > 200 || this.captionIssues().some(issue => issue.times || issue.text));
  });
  readonly captionStyleError = computed(() => {
    this.formVersion();
    return this.captionSource !== 'none' && (!Number.isInteger(this.fontSize) || this.fontSize < 12 || this.fontSize > 40)
      ? 'El tamaño de subtítulo debe ser un número entero entre 12 y 40.' : '';
  });
  readonly compositionError = computed(() => {
    this.formVersion();
    if (!['source', 'vertical', 'square', 'horizontal'].includes(this.spec.aspect)) return 'Elige un formato de salida válido.';
    if (this.spec.aspect !== 'source' && [this.cropX, this.cropY].some(value => !Number.isFinite(value) || value < 0 || value > 1)) return 'El encuadre debe quedar entre 0 y 1.';
    if (!this.splitEnabled) return '';
    if (this.spec.aspect === 'source') return 'La pantalla dividida necesita un formato vertical, cuadrado u horizontal.';
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(this.secondaryUploadId.trim())) return 'Indica el UUID de una segunda carga autorizada.';
    if (!Number.isFinite(this.primaryRatio) || this.primaryRatio < 0.2 || this.primaryRatio > 0.8) return 'La proporción principal debe quedar entre 20 % y 80 %.';
    if (!Number.isFinite(this.secondaryStart) || this.secondaryStart < 0 || this.secondaryStart > 14400) return 'El inicio del secundario debe quedar entre 0 y 14400 segundos.';
    return '';
  });
  readonly canSaveRevision = computed(() => this.canChangeCaptions() && this.dirty() && this.clipRangeUsable() && !this.invalidCaptions() && !this.captionStyleError() && !this.compositionError());
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
  private renderAttempt: { revisionId: string; version: number; key: string } | null = null;
  private commentKey = "";
  private commentBody = "";
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private editGeneration = 0;
  private unregisterNavigation: () => void = () => {};
  constructor() {
    this.unregisterNavigation = this.editorNavigation.register(this.id, () => this.confirmDiscard());
    this.destroy.onDestroy(() => {
      this.disposed = true;
      this.unregisterNavigation();
      this.editGeneration++;
      clearTimeout(this.timer);
    });
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroy)).subscribe((params) => {
      const nextId = params.get("id") ?? "";
      if (nextId === this.id) return;
      const previousId = this.id;
      if (!this.editorNavigation.consumeApproval(nextId) && !this.confirmDiscard()) {
        void this.router.navigateByUrl(previousId ? `/app/edits/${encodeURIComponent(previousId)}` : "/app/edits");
        return;
      }
      this.resetForEdit(nextId);
      this.unregisterNavigation();
      this.unregisterNavigation = this.editorNavigation.register(nextId, () => this.confirmDiscard());
      if (!this.design && nextId) void this.reload();
    });
    if (!this.design) void this.reload();
  }
  private resetForEdit(id: string): void {
    this.editGeneration++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.activeId.set(id);
    this.draft.set(null);
    this.project.set(null);
    this.sourceDuration.set(null);
    this.transcriptSegments.set([]);
    this.transcriptLoading.set(false);
    this.transcriptError.set("");
    this.transcriptGeneration++;
    this.cueSelection.set(null);
    this.captionActionError.set("");
    this.review.set(null);
    this.history.set([]);
    this.nextVersion.set(null);
    this.comments.set([]);
    this.nextComment.set(null);
    this.exports.set([]);
    this.exportsLoaded.set(false);
    this.exportsError.set("");
    this.exportsLoading.set(false);
    this.exportsGeneration++;
    this.renderReceipt.set(null);
    this.receiptLookups = 0;
    this.exportPhase.set('idle');
    this.tab.set("composition");
    this.busy.set(false);
    this.error.set("");
    this.loadNotice.set("");
    this.conflict.set(false);
    this.message.set("");
    this.previewUrl.set("");
    this.previewVersion.set("");
    this.previewGeneration++;
    this.previewSession.set(null);
    this.previewDuration.set(null);
    this.previewTime.set(null);
    this.previewError.set('');
    this.previewSeek.set(null);
    this.formVersion.set(0);
    this.spec = { version: 1, kind: "clip", startSeconds: 0, endSeconds: 30, aspect: "vertical" };
    this.cropX = 0.5;
    this.cropY = 0.5;
    this.splitEnabled = false;
    this.secondaryUploadId = "";
    this.primaryRatio = 0.5;
    this.secondaryStart = 0;
    this.splitLayout = "stacked";
    this.shortInput = "freeze";
    this.splitAudio = "primary";
    this.captionSource = "none";
    this.analysisId = "";
    this.cues = [];
    this.captionTemplate = "clean";
    this.captionPosition = "bottom";
    this.fontSize = 24;
    this.commentText = "";
    this.commentTime = 0;
    this.replyTarget.set(null);
    this.etag = null;
    this.initialForm = "";
    this.renderAttempt = null;
    this.commentKey = "";
    this.commentBody = "";
    this.touchForm();
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
    return !this.busy() && (!this.dirty() || this.discardConfirmation());
  }
  canRequestReview(): boolean {
    return this.canEditCollaboration() && this.review()?.status === "draft";
  }
  private isCurrentEdit(generation: number): boolean {
    return !this.disposed && generation === this.editGeneration;
  }
  setCaptionSource(source: string): void {
    if (!this.canChangeCaptions() || !['none', 'user', 'transcript'].includes(source) || (source === 'transcript' && !this.analysisId)) return;
    this.captionSource = source;
    this.cueSelection.set(null);
    this.captionActionError.set("");
    this.touchForm();
  }
  selectCue(index: number): void {
    if (!Number.isInteger(index) || !this.captionEntries().some(cue => cue.index === index)) { this.cueSelection.set(null); return; }
    this.cueSelection.set({ source: this.captionSource, index });
    this.tab.set('captions');
  }
  selectAdjacentCue(direction: -1 | 1): void {
    const entry = this.captionEntries()[this.selectedCuePosition() + direction];
    if (entry) this.selectCue(entry.index);
  }
  updateCue(index: number, field: 'startSeconds' | 'endSeconds' | 'text', value: number | string | null): void {
    if (!this.canChangeCaptions() || this.captionSource !== 'user' || !this.cues[index]) return;
    const next = { ...this.cues[index] };
    if (field === 'text') next.text = typeof value === 'string' ? value : '';
    else next[field] = typeof value === 'number' ? value : Number.NaN;
    this.cues = this.cues.map((cue, position) => position === index ? next : cue);
    this.cueSelection.set({ source: 'user', index });
    this.captionActionError.set("");
    this.touchForm();
  }
  startManualCaptions(): void {
    if (!this.canChangeCaptions()) return;
    this.setCaptionSource('user');
    this.tab.set('captions');
    this.addCue();
  }
  copyTranscriptToEditable(): void {
    if (!this.canChangeCaptions() || this.captionSource !== 'transcript' || this.transcriptLoading() || this.transcriptError()) return;
    this.captionActionError.set("");
    try {
      if (!this.clipRangeUsable())
        throw new Error('Corrige el intervalo del clip antes de copiar la transcripción.');
      const selected = this.selectedCue();
      this.cues = copyTranscriptCues(this.transcriptSegments(), this.spec.startSeconds, this.spec.endSeconds);
      this.captionSource = 'user';
      this.touchForm();
      const index = selected ? this.cues.findIndex(cue => cue.text === selected.text && cue.startSeconds === Math.max(selected.startSeconds, this.spec.startSeconds)) : 0;
      this.selectCue(Math.max(0, index));
      this.message.set('Copia editable creada en el borrador. El análisis original se conserva; guarda una revisión para persistir estos cambios.');
    } catch (error) { this.captionActionError.set(errorMessage(error)); }
  }
  addCue(): void {
    if (!this.canChangeCaptions() || this.captionSource !== 'user' || this.cues.length >= 200) return;
    const startSeconds = this.cues.at(-1)?.endSeconds ?? this.spec.startSeconds;
    if (!Number.isFinite(startSeconds) || startSeconds < this.spec.startSeconds || !this.clipRangeUsable()) {
      this.captionActionError.set('Corrige el intervalo y los tiempos de la última frase antes de añadir otra.');
      return;
    }
    if (startSeconds >= this.spec.endSeconds) { this.message.set('Ajusta el final de la última frase para dejar espacio a la siguiente.'); return; }
    this.cues = [...this.cues, { startSeconds, endSeconds: Math.min(startSeconds + 3, this.spec.endSeconds), text: '' }];
    this.touchForm();
    this.selectCue(this.cues.length - 1);
  }
  removeCue(index: number): void {
    if (!this.canChangeCaptions() || this.captionSource !== 'user' || !this.cues[index]) return;
    const selected = this.selectedCue()?.index;
    this.cues = this.cues.filter((_cue, i) => i !== index);
    this.touchForm();
    if (selected !== undefined) this.selectCue(Math.min(selected > index ? selected - 1 : selected, this.cues.length - 1));
  }
  private accept(
    draft: Schema<"EditorDraftDto">,
    etag: string | null = null,
    preserveSelection = false,
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
    if (!preserveSelection || this.cueSelection()?.source !== this.captionSource) this.cueSelection.set(null);
    this.captionActionError.set("");
    const style =
      captions && captions.source !== "none" ? captions.style : undefined;
    this.captionTemplate = style?.template ?? "clean";
    this.captionPosition = style?.position ?? "bottom";
    this.fontSize = style?.fontSize ?? 24;
    this.initialForm = this.snapshot();
    this.touchForm();
  }
  private async loadTranscript(): Promise<void> {
    const generation = this.editGeneration;
    const request = ++this.transcriptGeneration;
    const analysisId = this.analysisId;
    const current = () => this.isCurrentEdit(generation) && request === this.transcriptGeneration && analysisId === this.analysisId;
    this.transcriptSegments.set([]);
    this.transcriptError.set("");
    this.transcriptLoading.set(!!analysisId);
    if (!analysisId) return;
    try {
      const analysis = await this.api.analysis(analysisId);
      if (!current()) return;
      if (analysis.status !== 'succeeded' || !analysis.transcript)
        throw new Error('La transcripción vinculada todavía no está disponible para esta revisión.');
      this.transcriptSegments.set(analysis.transcript.segments);
    } catch (error) {
      if (!current()) return;
      this.transcriptError.set(errorMessage(error));
      throw error;
    } finally { if (current()) this.transcriptLoading.set(false); }
  }
  async retryTranscript(): Promise<void> {
    if (this.design || this.busy() || this.transcriptLoading() || !this.analysisId) return;
    await this.loadTranscript().catch(() => {});
  }
  async reload(): Promise<void> {
    if (this.busy() || !this.confirmDiscard()) return;
    const generation = this.editGeneration;
    await this.run(async () => {
      const result = await this.api.edit(this.id);
      if (!this.isCurrentEdit(generation)) return;
      this.accept(result.draft, result.etag);
      const labels = ["metadatos del proyecto", "metadatos de la fuente", "historial", "comentarios", "exportaciones", "revisión", "transcripción vinculada"];
      const results = await Promise.allSettled([
        this.api.project(result.draft.projectId),
        this.projectsApi.upload(result.draft.uploadId),
        this.loadHistory(),
        this.loadComments(),
        this.loadExports(),
        this.loadReview(),
        this.loadTranscript(),
      ]);
      if (!this.isCurrentEdit(generation)) return;
      if (results[0].status === "fulfilled") this.project.set(results[0].value);
      const upload = results[1];
      if (upload.status === "fulfilled" && upload.value.projectId === result.draft.projectId && upload.value.state === "confirmed" && upload.value.inspection?.status === "succeeded") {
        const measured = upload.value.inspection.result?.durationSeconds;
        if (measured && Number.isFinite(measured) && measured > 0) this.sourceDuration.set(measured);
      }
      const unavailable = results.flatMap((result, index) =>
        index !== 6 && (result.status === "rejected" ||
        (index === 4 && result.status === "fulfilled" && result.value === false))
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
    if (this.compositionError()) throw new Error(this.compositionError());
    if (this.captionStyleError()) throw new Error(this.captionStyleError());
    if (
      !Number.isFinite(this.spec.startSeconds) ||
      !Number.isFinite(this.spec.endSeconds) ||
      this.spec.startSeconds < 0 ||
      this.spec.endSeconds - this.spec.startSeconds < 0.1 ||
      this.spec.endSeconds - this.spec.startSeconds > 120 || this.spec.endSeconds > 14400
    )
      throw new Error("El intervalo debe durar entre 0,1 y 120 segundos.");
    if (this.sourceRangeInvalid()) throw new Error("El final del intervalo supera la duración medida de la fuente.");
    const result: Schema<"EditorSpecDto"> = { ...this.spec };
    if (result.aspect === 'source') delete result.framing;
    else result.framing = { x: Number(this.cropX), y: Number(this.cropY) };
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
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 65000)
      throw new Error('La revisión supera 65 000 bytes. Reduce el texto de los subtítulos o el intervalo antes de guardar.');
    return result;
  }
  async save(): Promise<void> {
    if (!this.canEditCollaboration()) return;
    const generation = this.editGeneration;
    await this.run(async () => {
      if (await this.saveRevision(generation)) await this.refreshRevisionMetadata(generation);
    });
  }
  private async saveRevision(generation: number): Promise<Schema<'EditorDraftDto'> | null> {
    const draft = this.draft();
    if (!draft || !this.dirty()) return null;
    const saved = await this.api.save(this.id, { version: draft.version, spec: this.buildSpec() }, this.etag ?? undefined);
    if (!this.isCurrentEdit(generation)) return null;
    this.accept(saved.draft, saved.etag, true);
    this.message.set(`Revisión ${saved.draft.version} guardada.`);
    return saved.draft;
  }
  async saveAndRender(): Promise<void> {
    if (!this.canSaveRevision()) return;
    const generation = this.editGeneration;
    await this.run(async () => {
      this.exportPhase.set('saving');
      let saved: Schema<'EditorDraftDto'> | null = null;
      try {
        saved = await this.saveRevision(generation);
        if (!saved || !this.isCurrentEdit(generation)) return;
        if (!this.canEditCollaboration()) {
          this.loadNotice.set('La revisión se guardó. Tu rol actual no permite solicitar su exportación.');
          return;
        }
        this.exportPhase.set('requesting');
        await this.requestRender(saved, generation);
        if (this.isCurrentEdit(generation)) this.message.set(`Revisión ${saved.version} guardada y exportación solicitada.`);
      } finally {
        if (saved && this.isCurrentEdit(generation)) await this.refreshRevisionMetadata(generation);
        if (this.isCurrentEdit(generation)) this.exportPhase.set('idle');
      }
    });
  }
  async loadHistory(append = false): Promise<void> {
    if (this.design) return;
    const generation = this.editGeneration;
    const result = await this.api.history(
      this.id,
      append ? this.nextVersion() : null,
    );
    if (!this.isCurrentEdit(generation)) return;
    this.history.set(
      append ? [...this.history(), ...result.items] : result.items,
    );
    this.nextVersion.set(result.nextBeforeVersion);
  }
  async moreHistory(): Promise<void> {
    await this.run(() => this.loadHistory(true));
  }
  async restore(version: number): Promise<void> {
    if (!this.canEditCollaboration()) return;
    const generation = this.editGeneration;
    await this.run(async () => {
      const draft = this.draft();
      if (!draft || this.dirty()) return;
      const restored = await this.api.restore(
        this.id,
        { version: draft.version, revisionVersion: version },
        this.etag ?? undefined,
      );
      if (!this.isCurrentEdit(generation)) return;
      this.accept(restored.draft, restored.etag);
      this.message.set(
        `Revisión ${version} recuperada como revisión ${restored.draft.version}.`,
      );
      await this.refreshRevisionMetadata();
    });
  }
  private async refreshRevisionMetadata(generation = this.editGeneration): Promise<void> {
    const [history, review] = await Promise.allSettled([
      this.loadHistory(),
      this.loadReview(),
      this.loadTranscript(),
    ]);
    if (!this.isCurrentEdit(generation)) return;
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
    if (this.design) return;
    const generation = this.editGeneration;
    const result = await this.collaboration.review(this.id);
    if (this.isCurrentEdit(generation)) this.review.set(result);
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
    if (!this.canEditCollaboration() || (path !== "review" && !this.canAdminCollaboration())) return;
    const generation = this.editGeneration;
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
      if (!this.isCurrentEdit(generation)) return;
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
    const generation = this.editGeneration;
    const result = await this.collaboration.comments(this.id, {
      beforeId: append ? this.nextComment() : null,
    });
    if (!this.isCurrentEdit(generation)) return;
    this.comments.set(
      append ? [...this.comments(), ...result.items] : result.items,
    );
    this.nextComment.set(result.nextBeforeId);
  }
  async moreComments(): Promise<void> {
    await this.run(() => this.loadComments(true));
  }
  async comment(): Promise<void> {
    if (!this.canEditCollaboration()) return;
    const generation = this.editGeneration;
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
      if (!this.isCurrentEdit(generation)) return;
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
    const role = this.collaborationRole();
    const isOwnerOrAdmin = role === "owner" || role === "admin";
    const isOwnEditorComment = role === "editor" && item.authorId === this.sessionStore.user()?.id;
    if (!isOwnerOrAdmin && !isOwnEditorComment) return;
    const generation = this.editGeneration;
    await this.run(async () => {
      const deleted = await this.collaboration.deleteComment(this.id, item.id, { version: item.version });
      if (!this.isCurrentEdit(generation)) return;
      this.comments.update((items) => items.map((comment) => comment.id === deleted.id ? deleted : comment));
      this.message.set("Comentario retirado.");
      try { await this.loadComments(); }
      catch { this.loadNotice.set("El comentario se retiró, pero no se pudo actualizar la lista."); }
    });
  }
  async loadExports(): Promise<boolean> {
    if (this.design) return true;
    const generation = this.editGeneration;
    const request = ++this.exportsGeneration;
    const current = () => this.isCurrentEdit(generation) && request === this.exportsGeneration;
    clearTimeout(this.timer);
    this.exportsLoading.set(true);
    try {
      const result = await this.api.exports(this.id);
      if (!current()) return false;
      this.exports.set(result.items);
      this.exportsLoaded.set(true);
      this.exportsError.set("");
      const receiptMissing = !!this.renderReceipt() && !result.items.some(item => item.id === this.renderReceipt()?.id);
      if (receiptMissing) this.receiptLookups++;
      if (result.items.some((e) => ["queued", "running"].includes(e.status)) || (receiptMissing && this.receiptLookups < 5))
        this.timer = setTimeout(() => void this.loadExports(), 4000);
      return true;
    } catch (error) {
      if (!current()) return false;
      this.exportsError.set(`No se pudieron cargar las exportaciones: ${errorMessage(error)}`);
      return false;
    } finally { if (current()) this.exportsLoading.set(false); }
  }
  exportStatusLabel(status: Schema<"EditorExportDto">["status"]): string {
    return { queued: "En cola", running: "Procesando", succeeded: "Lista", failed: "Fallida", cancelled: "Cancelada" }[status];
  }
  async render(): Promise<void> {
    if (!this.canEditCollaboration()) return;
    const generation = this.editGeneration;
    await this.run(async () => {
      const draft = this.draft();
      if (!draft || this.dirty()) return;
      if (this.currentRenderPending()) {
        this.tab.set('exports');
        this.message.set('Ya hay una solicitud de esta revisión. Consulta su estado en Exportaciones.');
        return;
      }
      this.exportPhase.set('requesting');
      try { await this.requestRender(draft, generation); }
      finally { if (this.isCurrentEdit(generation)) this.exportPhase.set('idle'); }
    });
  }
  private async requestRender(draft: Schema<'EditorDraftDto'>, generation: number): Promise<void> {
    if (!this.isCurrentEdit(generation) || this.dirty() || this.draft()?.revision.id !== draft.revision.id) return;
    if (this.renderAttempt?.revisionId !== draft.revision.id || this.renderAttempt.version !== draft.version)
      this.renderAttempt = { revisionId: draft.revision.id, version: draft.version, key: crypto.randomUUID() };
    const accepted = await this.api.render(this.id, draft.version, this.renderAttempt.key);
    if (!this.isCurrentEdit(generation)) return;
    this.renderAttempt = null;
    this.renderReceipt.set({ id: accepted.id, revisionId: draft.revision.id, version: draft.version });
    this.receiptLookups = 0;
    this.tab.set('exports');
    await this.loadExports();
    if (this.isCurrentEdit(generation)) this.message.set(`Exportación solicitada para la revisión ${draft.version}.`);
  }
  async cancelRender(id: string): Promise<void> {
    if (!this.canEditCollaboration()) return;
    const generation = this.editGeneration;
    await this.run(async () => {
      await this.api.cancelRender(id);
      if (!this.isCurrentEdit(generation)) return;
      await this.loadExports();
    });
  }
  revisionLabel(id: string | undefined): string {
    if (id && id === this.draft()?.revision.id) return String(this.draft()!.version);
    return id
      ? String(this.history().find((r) => r.id === id)?.version ?? id)
      : "No informada";
  }
  hasVideoArtifact(item: Schema<'EditorExportDto'>): boolean {
    return item.status === 'succeeded' && item.artifacts.some(artifact => artifact.kind === 'video');
  }
  async preview(requested: Schema<"EditorExportDto">): Promise<void> {
    const item = this.exports().find(exported => exported.id === requested.id);
    if (!item || !this.hasVideoArtifact(item)) return;
    const generation = this.editGeneration;
    await this.run(async () => {
      const result = await this.api.download(item.id, "video");
      if (!this.isCurrentEdit(generation)) return;
      this.safeUrl(result.url);
      this.previewSession.set({ token: ++this.previewGeneration, exportId: item.id, revisionId: item.editorRevisionId, url: result.url });
      this.previewDuration.set(null);
      this.previewTime.set(null);
      this.previewError.set('');
      this.previewSeek.set(null);
      this.previewUrl.set(result.url);
      this.previewVersion.set(this.revisionLabel(item.editorRevisionId));
      this.message.set(
        "Reproduciendo exportación guardada. Si el enlace vence, selecciona Reproducir de nuevo.",
      );
    });
  }
  previewMetadata(token: number, duration: number): void {
    if (token !== this.previewSession()?.token) return;
    this.previewDuration.set(Number.isFinite(duration) && duration > 0 ? duration : null);
    if (this.previewDuration() === null) this.previewError.set('El video no informa una duración válida. Solicita otro enlace de reproducción.');
  }
  previewTimeChanged(token: number, seconds: number): void {
    const duration = this.previewDuration();
    if (token !== this.previewSession()?.token || this.previewError() || duration === null || !Number.isFinite(seconds) || seconds < 0 || seconds > duration) return;
    this.previewTime.set(seconds);
  }
  previewFailed(token: number): void {
    if (token !== this.previewSession()?.token) return;
    this.previewError.set('No pudimos reproducir el video. El enlace puede haber vencido; solicita uno nuevo.');
    this.previewTime.set(null);
  }
  seekSelectedCue(): void {
    const seconds = this.selectedCueSeekTime();
    const session = this.previewSession();
    if (!session || seconds === null || this.busy()) return;
    this.previewSeek.set({ token: session.token, sequence: ++this.seekSequence, seconds });
  }
  async refreshPreview(): Promise<void> {
    const item = this.exports().find(item => item.id === this.previewSession()?.exportId);
    if (!item || !this.hasVideoArtifact(item)) {
      this.previewError.set('Esta exportación ya no está disponible en la lista. Actualiza Exportaciones para consultar su estado.');
      return;
    }
    await this.preview(item);
  }
  artifactLabel(kind: Schema<'ProcessingArtifactDto'>['kind']): string {
    return { video: 'Video', audio: 'Audio', srt: 'Subtítulos SRT', vtt: 'Subtítulos VTT' }[kind];
  }
  async download(id: string, kind: Schema<'ProcessingArtifactDto'>['kind']): Promise<void> {
    const item = this.exports().find(item => item.id === id && item.status === 'succeeded');
    const artifact = item?.artifacts.find(artifact => artifact.kind === kind);
    if (!item || !artifact) return;
    const generation = this.editGeneration;
    const revision = this.revisionLabel(item.editorRevisionId);
    const extension = kind === 'video' && artifact.contentType === 'video/mp4' ? 'mp4' : kind === 'audio' && ['audio/wav', 'audio/x-wav'].includes(artifact.contentType) ? 'wav' : kind;
    await this.run(async () => {
      const result = await this.api.download(id, kind);
      if (!this.isCurrentEdit(generation)) return;
      await this.artifactDownload(result.url, `autoclipper-revision-${revision}-${id}.${extension}`);
      if (this.isCurrentEdit(generation)) this.message.set(`${this.artifactLabel(kind)} de la revisión ${revision} descargado.`);
    });
  }
  private safeUrl(value: string): string {
    const parsed = new URL(value);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new Error("El servidor devolvió una URL inválida.");
    return parsed.href;
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.design || this.busy()) return;
    const generation = this.editGeneration;
    this.busy.set(true);
    this.error.set("");
    this.loadNotice.set("");
    this.conflict.set(false);
    this.message.set("");
    try {
      await action();
    } catch (error) {
      if (!this.isCurrentEdit(generation)) return;
      this.error.set(errorMessage(error));
      this.conflict.set(
        error instanceof HttpErrorResponse && error.status === 412,
      );
    } finally {
      if (this.isCurrentEdit(generation)) this.busy.set(false);
    }
  }
}
