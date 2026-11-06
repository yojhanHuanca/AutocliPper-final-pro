import { SocialPublishComponent } from "../../../shared/ui/social-publish/social-publish.component";
import { DESIGN_MODE } from "../../../core/config/design-mode.token";
import { ProjectsApi } from "../data-access/projects-api.service";
import { downloadPrivateArtifact, fetchPrivateArtifact } from '../../../core/http/artifact-download';
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
import { uploadContentType, type UploadPhase } from '../models/upload-file';
import { pipelineProgress } from '../models/pipeline-progress';
import { SourceLinkPreviewComponent } from '../components/source-link-preview.component';

type EditList = Response<"/v1/projects/{id}/edits">;
type EditorSubtitles = NonNullable<Schema<'EditorSpecDto'>['subtitles']>;
@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-project",
  imports: [FormsModule, RouterLink, DatePipe, DecimalPipe, IconComponent, SourceLinkPreviewComponent, SocialPublishComponent],
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
  readonly manualProcessing = signal<Schema<"ProcessingStatusDto"> | null>(null);
  readonly resultKind = signal<'pipeline' | 'manual'>('pipeline');
  readonly manualProcessingError = signal('');
  readonly manualProcessingBusy = signal(false);
  manualProcessingId = '';
  private manualProcessingUploadId = '';
  private manualProcessingKey = '';
  private manualProcessingBody = '';
  private manualProcessingGeneration = 0;
  private manualProcessingTimer?: ReturnType<typeof setTimeout>;
  readonly busy = signal(false);
  readonly uploading = signal(false);
  readonly error = signal("");
  readonly loadNotice = signal("");
  readonly projectLoadError = signal('');
  readonly message = signal("");
  readonly uploadError = signal("");
  readonly uploadFailure = signal("");
  readonly pipelineError = signal("");
  readonly pipelineManualFallbackAvailable = signal(false);
  readonly clipPreviewUrl = signal('');
  readonly clipPreviewError = signal('');
  readonly clipPreviewLoading = signal(false);
  private clipPreviewGeneration = 0;
  readonly inspecting = signal(false);
  readonly pollingPipeline = signal(false);
  readonly sourceDurationSeconds = computed<number | null>(() => {
    const status = this.uploadStatus();
    if (!status || status.id !== this.uploadId.trim() || status.projectId !== this.id || status.state !== "confirmed" || status.inspection?.status !== "succeeded") return null;
    const duration = status.inspection?.result?.durationSeconds;
    return typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : null;
  });
  readonly sourceSelectionLimitSeconds = computed(() => Math.min(300, this.sourceDurationSeconds() ?? 0));
  readonly intervalReady = computed(() => this.inspected() && (this.sourceDurationSeconds() ?? 0) >= 0.1);
  readonly projectRole = computed(() => {
    if (!this.workspace.loaded()) return "loading" as const;
    const project = this.project();
    if (!project) return "loading-project" as const;
    return this.workspace.workspaces().find((item) => item.id === project.workspaceId)?.role ?? "unavailable" as const;
  });
  readonly selectedFile = signal<File | null>(null);
  get file(): File | null { return this.selectedFile(); }
  set file(value: File | null) { this.selectedFile.set(value); }
  readonly selectionError = signal('');
  readonly intervalNotice = signal('');
  readonly localPreview = signal('');
  readonly previewUnavailable = signal(false);
  readonly draggingFile = signal(false);
  readonly uploadPhase = signal<UploadPhase | null>(null);
  readonly sourceFileName = signal('');
  readonly sourceOriginProvider = signal<'twitch' | 'youtube' | null>(null);
  private namedUploadId = '';
  private readonly confirmedFile = signal<File | null>(null);
  private get uploadedFile(): File | null { return this.confirmedFile(); }
  private set uploadedFile(value: File | null) { this.confirmedFile.set(value); }
  readonly sourceMilestones = ['Preparar', 'Transferir', 'Inspeccionar', 'Listo'];
  uploadId = "";
  pipelineId = "";
  private pipelineUploadId = '';
  private uploadGeneration = 0;
  private pipelineGeneration = 0;
  startSeconds = 0;
  endSeconds = 30;
  aspect: Schema<"PipelineSpecDto">["aspect"] = "vertical";
  language: Schema<"PipelineSpecDto">["language"] = "auto";
  generationMode: 'automatic' | 'manual' = 'automatic';
  clipCount: Schema<'AutomaticPipelineSpecDto'>['clipCount'] = 3;
  maxDurationSeconds: number | null = 30;
  limitClipDuration = false;
  contentType: Schema<'AutomaticPipelineSpecDto'>['contentType'] = 'general';
  selectionInstructions = '';
  includeSubtitles = true;
  subtitleStyle: Schema<'SubtitleStyleDto'> = { template: 'clean', fontSize: 24, position: 'bottom' };
  readonly clipPreviewIndex = signal<number | null>(null);
  private timer?: ReturnType<typeof setTimeout>;
  private inspectionTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private pipelineKey = "";
  private pipelineBody = "";
  private editKey = "";
  private editBody = "";
  private projectGeneration = 0;
  private intervalUploadId = "";
  private resumeConfiguration: unknown = null;
  private activeUploadController?: AbortController;
  private activeUploadId = "";
  readonly cancellingUpload = signal(false);
  readonly workbench = signal<"source" | "processing" | "drafts">("source");
  readonly creatorStep = signal<'source' | 'configuration' | 'generation' | 'review'>('source');
  readonly creatorWizardOpen = signal(!!this.design);
  readonly creatorCloseRequested = signal(false);
  readonly providerStatus = signal<Awaited<ReturnType<ProjectsApi['analysisProviders']>> | null>(null);
  readonly providerLoading = signal(false);
  readonly providerError = signal('');
  clipTitle = '';
  readonly reviewFilter = signal<'all' | 'ready' | 'attention' | 'working'>('all');
  private providerGeneration = 0;
  private previousBodyOverflow: string | null = null;
  readonly creatorSteps = [
    { id: 'source', label: 'Fuente' },
    { id: 'configuration', label: 'Configuración' },
    { id: 'generation', label: 'Generación' },
    { id: 'review', label: 'Revisión' },
  ] as const;
  creatorStepIndex(): number { return this.creatorSteps.findIndex(step => step.id === this.creatorStep()); }
  creatorStepLabel(): string { return this.creatorSteps[this.creatorStepIndex()]?.label ?? 'Fuente'; }
  creatorStepTitle(): string {
    if (this.workbench() === 'drafts') return 'Retoma una edición guardada';
    switch (this.creatorStep()) {
      case 'configuration': return 'Define cómo quedarán tus clips';
      case 'generation': return this.resultHeading();
      case 'review': return this.resultHeading();
      default: return 'Añade tu video';
    }
  }
  readonly sourceMode = signal<'file' | 'link'>('file');
  readonly linkPreviewOpened = signal(false);
  readonly linkPreviewAvailable = signal(false);
  readonly sourceLinkDraft = signal('');
  private readonly resumeCreatorStep = signal<(typeof this.creatorSteps)[number]['id'] | null>(null);
  readonly processingSourceReady = computed(() => this.sourceMode() === 'file' && this.intervalReady() && !this.hasUnuploadedSelection());
  readonly canConfigureGeneration = computed(() => this.canEdit() && this.processingSourceReady());
  private continueAfterTwitchImport = false;
  showSource(mode: 'file' | 'link', focus = false): void {
    if (mode === 'link') this.linkPreviewOpened.set(true);
    if (mode === 'link') this.continueAfterTwitchImport = false;
    this.sourceMode.set(mode);
    if (focus && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { if (!this.disposed) document.getElementById(`source-mode-${mode}`)?.focus(); });
  }
  continueWithCurrentUpload(focus = true): void {
    if (!this.intervalReady() || !this.canEdit()) return;
    if (this.hasUnuploadedSelection()) { this.file = null; this.releaseLocalPreview(); this.selectionError.set(''); }
    this.continueAfterTwitchImport = false;
    this.sourceMode.set('file');
    this.goToCreatorStep('configuration', focus);
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
  creatorStepAvailable(step: (typeof this.creatorSteps)[number]['id']): boolean {
    if (step === 'source') return true;
    if (step === 'configuration') return this.processingSourceReady();
    if (step === 'generation') return this.processingSourceReady() && (!!this.pipelineId || !!this.manualProcessingId);
    return this.processingSourceReady() && this.reviewReady();
  }
  onLinkPreviewAvailable(available: boolean): void { this.linkPreviewAvailable.set(available); }
  onSourceLinkChanged(value: string): void {
    this.sourceLinkDraft.set(value);
    this.remember();
  }
  continueToConfiguration(): void { this.goToCreatorStep('configuration', true); }
  reviewReady(): boolean {
    const status = this.resultKind() === 'manual' ? this.manualProcessing()?.status : this.pipeline()?.status;
    return !!status && ['succeeded','partial_failed','failed','cancelled'].includes(status);
  }
  resultInProgress(): boolean {
    if (this.resultKind() === 'pipeline') return this.pipelineInProgress() || (!!this.pipelineId && !this.pipeline());
    return ['queued','running'].includes(this.manualProcessing()?.status ?? '') || (!!this.manualProcessingId && !this.manualProcessing());
  }
  resultMatchesSelectedUpload(): boolean {
    return this.resultKind() === 'manual' ? !!this.manualProcessingUploadId && this.manualProcessingUploadId === this.uploadId.trim() : this.pipelineMatchesSelectedUpload();
  }
  showResult(kind: 'pipeline' | 'manual'): void {
    if ((kind === 'pipeline' && !this.pipelineId) || (kind === 'manual' && !this.manualProcessingId)) return;
    this.releaseClipPreview();
    this.resultKind.set(kind);
    this.creatorStep.set(this.reviewReady() ? 'review' : 'generation');
    this.showWorkbench('processing');
  }
  resultHeading(): string {
    const status = this.resultKind() === 'manual' ? this.manualProcessing()?.status : this.pipeline()?.status;
    if (!status) return 'Consulta el estado de tu trabajo';
    if (status === 'failed') return 'Este trabajo no se completó';
    if (status === 'cancelled') return 'El trabajo se canceló';
    if (status === 'partial_failed') return 'Hay clips listos y otros con error';
    if (status === 'succeeded') return this.resultKind() === 'manual' ? 'Tu clip está listo' : 'Revisa tus clips';
    return 'Sigue el procesamiento de tu video';
  }
  resultReadyCount(): number {
    if (this.resultKind() === 'manual') return this.manualProcessing()?.status === 'succeeded' ? 1 : 0;
    const task = this.pipeline();
    if (!task) return 0;
    return this.automaticPipeline(task) ? task.clips?.filter(clip => clip.status === 'succeeded').length ?? 0 : task.status === 'succeeded' ? 1 : 0;
  }
  canConfigureResult(): boolean {
    if (!this.canConfigureGeneration() || this.busy()) return false;
    return this.resultKind() === 'manual' ? this.manualProcessingUploadId === this.uploadId.trim() && !!this.manualProcessing() : this.pipelineMatchesSelectedUpload() && !!this.pipeline();
  }
  configureFromResult(focus = true): void {
    if (!this.canConfigureResult()) return;
    const manual = this.resultKind() === 'manual' ? this.manualProcessing() : null;
    const pipeline = this.resultKind() === 'pipeline' ? this.pipeline() : null;
    if (pipeline && this.automaticPipeline(pipeline)) {
      const spec = pipeline.spec;
      this.generationMode = 'automatic'; this.clipCount = spec.clipCount; this.aspect = spec.aspect;
      this.language = spec.language; this.contentType = spec.contentType; this.selectionInstructions = spec.instructions || '';
      this.limitClipDuration = spec.maxDurationSeconds !== undefined; this.maxDurationSeconds = spec.maxDurationSeconds ?? 30;
      this.includeSubtitles = spec.subtitles.source === 'transcript';
      if (spec.subtitles.source === 'transcript') this.subtitleStyle = spec.subtitles.style ? { ...spec.subtitles.style } : {template:'clean',fontSize:24,position:'bottom'};
    } else {
      const spec = manual?.spec ?? pipeline?.spec;
      if (!spec || !('startSeconds' in spec) || !('endSeconds' in spec) || typeof spec.startSeconds !== 'number' || typeof spec.endSeconds !== 'number') return;
      this.generationMode = 'manual'; this.startSeconds = spec.startSeconds; this.endSeconds = spec.endSeconds; this.aspect = spec.aspect ?? 'source';
    }
    this.pipelineError.set(''); this.pipelineManualFallbackAvailable.set(false);
    this.goToCreatorStep('configuration', focus);
  }
  async retryManualProcessingResult(): Promise<void> {
    const task = this.manualProcessing();
    if (!task || task.id !== this.manualProcessingId.trim() || !['failed', 'cancelled'].includes(task.status) || this.manualProcessingUploadId !== this.uploadId.trim() || !this.processingSourceReady() || !this.canEdit() || this.busy()) return;
    this.configureFromResult(false);
    if (this.creatorStep() === 'configuration') await this.startManualProcessing();
  }
  goToCreatorStep(step: (typeof this.creatorSteps)[number]['id'], focus = false): void {
    if (!this.creatorStepAvailable(step)) return;
    this.creatorStep.set(step);
    this.showWorkbench(step === 'source' ? 'source' : 'processing');
    this.remember();
    if (step === 'configuration') void this.refreshGenerationReadiness();
    if (focus && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
      if (this.disposed) return;
      document.querySelector('.creator-wizard-main')?.scrollTo({ top: 0 });
      document.getElementById(step === 'source' ? 'project-source-panel' : 'project-processing-panel')?.focus();
    });
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
    if (this.sourceMode() === 'link' && this.linkPreviewAvailable()) return 'Volver a la vista previa';
    if (this.intervalReady() && this.sourceMode() === 'link') return "Continuar con el MP4 cargado";
    return this.intervalReady() ? "Preparar el corte" : "Elegir mi video";
  }
  closeCreatorWizard(): void {
    this.creatorCloseRequested.set(false);
    this.creatorWizardOpen.set(false);
    if (typeof document !== 'undefined' && this.previousBodyOverflow !== null) {
      document.body.style.overflow = this.previousBodyOverflow;
      this.previousBodyOverflow = null;
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
      if (!this.disposed) {
        const createButton = document.getElementById('project-create-clips-button') as HTMLButtonElement | null;
        (createButton?.disabled ? document.getElementById('project-refresh-button') : createButton)?.focus();
      }
    });
  }
  openCreatorWizard(sourceMode?: 'file' | 'link'): void {
    if ((!this.design && !this.project()) || this.busy()) return;
    if (sourceMode) this.showSource(sourceMode);
    if (typeof document !== 'undefined' && this.previousBodyOverflow === null) {
      this.previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    this.creatorWizardOpen.set(true);
    const savedStep = this.resumeCreatorStep();
    const resumeStep = savedStep && this.creatorStepAvailable(savedStep) ? savedStep : null;
    const target = sourceMode ? 'source' : resumeStep ?? (!this.processingSourceReady() ? 'source' : this.reviewReady() && this.resultMatchesSelectedUpload()
      ? 'review'
      : this.resultInProgress()
        ? 'generation'
      : this.processingSourceReady()
          ? 'configuration'
          : 'source');
    this.creatorStep.set(target);
    this.workbench.set(target === 'source' ? 'source' : 'processing');
    this.remember();
    if (target === 'configuration') void this.refreshGenerationReadiness();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
      if (!this.disposed) document.getElementById('creator-wizard-close')?.focus();
    });
  }
  private openCreatorWizardFromNavigation(): void {
    if (this.route?.snapshot?.queryParamMap?.get?.('createClips') !== '1' || !this.project() || !this.canEdit()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { createClips: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.openCreatorWizard();
  }
  requestCloseCreatorWizard(): void {
    if (!this.hasUnuploadedSelection() && !this.linkPreviewOpened()) { this.closeCreatorWizard(); return; }
    this.creatorCloseRequested.set(true);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => document.getElementById('wizard-keep-working')?.focus());
  }
  keepCreatorOpen(): void {
    this.creatorCloseRequested.set(false);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => document.getElementById('creator-wizard-close')?.focus());
  }
  discardCreatorSelection(): void {
    if (this.uploading()) return;
    if (this.hasUnuploadedSelection()) { this.file = null; this.releaseLocalPreview(); this.selectionError.set(''); }
    this.linkPreviewOpened.set(false);
    this.linkPreviewAvailable.set(false);
    this.sourceLinkDraft.set('');
    this.resumeCreatorStep.set(null);
    this.sourceMode.set('file');
    this.remember();
    this.closeCreatorWizard();
  }
  sourceActionLabel(): string {
    if (this.sourceMode() === 'link') return 'Usar archivo MP4';
    if (this.hasUnuploadedSelection() && !this.uploadBlocked()) return this.uploading() ? 'Cargando video…' : 'Cargar e inspeccionar video';
    if (this.processingSourceReady()) return 'Continuar a configuración';
    return this.uploadId ? 'Consultar inspección' : 'Selecciona un video';
  }
  sourceActionDisabled(): boolean {
    if (this.sourceMode() === 'link') return this.busy() || this.uploading();
    if (this.busy() || !this.canEdit() || this.uploading()) return true;
    if (this.hasUnuploadedSelection() && !this.uploadBlocked()) return !!this.selectionError();
    return !this.processingSourceReady() && (!this.uploadId || this.inspecting());
  }
  async advanceSource(): Promise<void> {
    if (this.sourceActionDisabled()) return;
    if (this.sourceMode() === 'link') { this.showSource('file', true); return; }
    if (this.hasUnuploadedSelection() && !this.uploadBlocked()) await this.upload();
    else if (this.processingSourceReady()) this.continueToConfiguration();
    else await this.inspect();
  }
  async refreshGenerationReadiness(): Promise<void> {
    if (this.design || !this.project() || typeof this.api?.analysisProviders !== 'function') return;
    const request = ++this.providerGeneration, project = this.projectGeneration;
    this.providerLoading.set(true); this.providerError.set('');
    try {
      const status = await this.api.analysisProviders();
      if (request === this.providerGeneration && this.isCurrentProject(project)) { this.providerStatus.set(status); if (this.localAutomaticSelectionReady()) this.pipelineManualFallbackAvailable.set(false); }
    } catch {
      if (request === this.providerGeneration && this.isCurrentProject(project)) {
        this.providerStatus.set(null);
        this.providerError.set('No pudimos consultar la disponibilidad de la selección automática. Al enviar, el servidor volverá a comprobarla.');
      }
    } finally {
      if (request === this.providerGeneration && this.isCurrentProject(project)) this.providerLoading.set(false);
    }
  }
  generationReadinessMessage(): string {
    const status = this.providerStatus();
    if (!status) return this.providerError() || 'Consultando la disponibilidad de la IA.';
    if (this.automaticProviderMismatch()) return this.pipelineFailureMessage('SELECTION_NOT_CONFIGURED');
    if (this.localAutomaticSelectionReady()) return 'Listo: Whisper transcribe y la IA selecciona momentos relevantes. FFmpeg recorta los intervalos elegidos.';
    if (status.transcription?.whisper_cpp.configured === false) return this.manualIntervalAvailable()
      ? 'Whisper local no está configurado en el servidor. No se inició ningún trabajo; puedes elegir un intervalo manual o volver a intentarlo cuando esté listo.'
      : 'Whisper local no está configurado en el servidor. No se inició ningún trabajo; vuelve a intentarlo cuando esté listo.';
    return status.selection?.provider === 'local_ai' ? 'El modelo de IA local todavía no está listo. Inicia el servicio local y verifica que el modelo esté instalado. No necesita una API de pago.' : 'La IA no está lista. Configura el proveedor y su presupuesto en el servidor. No se sustituirá por recortes repartidos o aleatorios.';
  }
  generationModeHint(): string {
    return this.generationMode === 'manual'
      ? 'Elegirás un intervalo y crearás un MP4. Los subtítulos se pueden añadir después en el editor.'
      : `Se solicitarán ${this.clipCount} ${this.clipCount === 1 ? 'clip' : 'clips'} al backend: Whisper transcribe y la IA elige los momentos según el contenido y tus indicaciones.`;
  }
  manualIntervalAvailable(): boolean { return this.sourceOriginProvider() !== 'twitch'; }
  automaticProviderMismatch(): boolean {
    const status = this.providerStatus();
    return !!status && !['openai','gemini','local_ai'].includes(status.selection?.provider ?? '');
  }
  localAutomaticSelectionReady(): boolean {
    const status = this.providerStatus();
    return status?.transcription?.whisper_cpp?.configured === true && status?.selection?.readiness?.status === 'ready';
  }
  generationActionDisabled(): boolean {
    return this.busy() || !this.canConfigureGeneration() || this.manualProcessingBusy() || this.pipelineBlocksSelectedUpload() ||
      (this.manualProcessingUploadId === this.uploadId.trim() && !!this.manualProcessing() && ['queued','running'].includes(this.manualProcessing()!.status)) ||
      (this.generationMode === 'automatic' && (this.providerLoading() || !this.localAutomaticSelectionReady() || this.pipelineManualFallbackAvailable()));
  }
  async generateConfiguredClips(): Promise<void> {
    if (this.generationActionDisabled()) return;
    if (this.generationMode === 'automatic') await this.startAutomaticPipeline();
    else await this.startManualProcessing();
  }
  wizardBack(): void {
    if (this.creatorStep() === 'configuration') this.goToCreatorStep('source', true);
    else if (this.creatorStep() === 'generation') this.goToCreatorStep('configuration', true);
    else if (this.creatorStep() === 'review') this.goToCreatorStep('generation', true);
  }
  chooseFileSource(focus = true): void {
    this.showSource('file');
    this.goToCreatorStep('source', focus);
  }
  creatorWizardKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.creatorCloseRequested()) this.keepCreatorOpen();
      else this.requestCloseCreatorWizard();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = this.creatorCloseRequested() ? (event.currentTarget as HTMLElement).querySelector('.wizard-exit-confirm')! : event.currentTarget as HTMLElement;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )).filter(element => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  pipelineDraftWaiting(): boolean {
    return this.pipelineInProgress() && (!this.hasKnownPipelineUpload() || this.pipelineMatchesSelectedUpload());
  }
  canCreateDraft(): boolean {
    return this.processingSourceReady() && !this.pipelineDraftWaiting();
  }
  async continueProject(): Promise<void> {
    if (this.disposed || this.design || !this.project() || this.busy()) return;
    if (this.createdDraft()) { await this.openCreatedDraft(); return; }
    const draft = this.edits()[0];
    if (draft) { await this.router.navigateByUrl(`/app/edits/${encodeURIComponent(draft.id)}`); return; }
    this.openCreatorWizard();
    if (this.sourceMode() === 'link') { this.creatorStep.set('source'); this.showWorkbench('source', true); return; }
    this.goToCreatorStep(this.intervalReady() ? "configuration" : "source", true);
  }
  hasActiveUpload(): boolean { return !!this.activeUploadId; }
  uploadBlocked(): boolean {
    if (!this.file || !this.hasUnuploadedSelection()) return true;
    const id = this.uploadId.trim();
    if (!id) return false;
    const status = this.uploadStatus();
    return !status || status.id !== id || status.state === 'pending';
  }
  uploadRecoveryLabel(): string {
    const id = this.uploadId.trim();
    if (!id || !this.uploadBlocked() || !this.file || !this.hasUnuploadedSelection()) return '';
    const status = this.uploadStatus();
    return status?.id === id && status.state === 'pending'
      ? 'Hay una carga temporal pendiente. Abórtala para liberar su reserva antes de volver a cargar.'
      : 'Consulta la carga seleccionada antes de iniciar otra transferencia.';
  }
  constructor() {
    if (this.creatorWizardOpen() && typeof document !== 'undefined') {
      this.previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroy)).subscribe((params) => {
      const nextId = params.get("id") ?? "";
      if (nextId !== this.id) this.switchProject(nextId);
    });
    this.destroy.onDestroy(() => {
      if (typeof document !== 'undefined' && this.previousBodyOverflow !== null) document.body.style.overflow = this.previousBodyOverflow;
      this.releaseLocalPreview();
      this.releaseClipPreview();
      this.disposed = true;
      this.projectGeneration++;
      this.uploadGeneration++;
      this.pipelineGeneration++;
      this.manualProcessingGeneration++;
      clearTimeout(this.timer);
      clearTimeout(this.manualProcessingTimer);
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
  rememberConfiguration(): void { this.remember(); }
  private remember(): void {
    try {
      const key = this.storageKey();
      if (!key) return;
      const link = this.sourceLinkDraft();
      if (!this.uploadId && !this.pipelineId && !this.manualProcessingId && !link) { sessionStorage.removeItem(key); return; }
      sessionStorage.setItem(
        key,
        JSON.stringify({
          uploadId: this.uploadId,
          pipelineId: this.pipelineId,
          pipelineUploadId: this.pipelineUploadId,
          manualProcessingId: this.manualProcessingId,
          manualProcessingUploadId: this.manualProcessingUploadId,
          sourceLink: link,
          sourceMode: this.sourceMode(),
          sourceOriginProvider: this.sourceOriginProvider(),
          creatorStep: this.creatorStep(),
          configuration: {
            generationMode: this.generationMode,
            clipTitle: this.clipTitle,
            clipCount: this.clipCount,
            limitClipDuration: this.limitClipDuration,
            maxDurationSeconds: this.maxDurationSeconds,
            startSeconds: this.startSeconds,
            endSeconds: this.endSeconds,
            aspect: this.aspect,
            language: this.language,
            contentType: this.contentType, selectionInstructions: this.selectionInstructions,
            includeSubtitles: this.includeSubtitles,
            subtitleStyle: this.subtitleStyle,
          },
        }),
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
      const refs: { uploadId?: string; pipelineId?: string; pipelineUploadId?: string; manualProcessingId?: string; sourceLink?: string; sourceMode?: string; sourceOriginProvider?: string | null; creatorStep?: string; configuration?: unknown } = JSON.parse(stored);
      this.uploadId = typeof refs.uploadId === "string" ? refs.uploadId : "";
      this.pipelineId = typeof refs.pipelineId === "string" ? refs.pipelineId : "";
      this.manualProcessingId = typeof refs.manualProcessingId === 'string' ? refs.manualProcessingId : '';
      this.sourceOriginProvider.set(refs.sourceOriginProvider === 'twitch' || refs.sourceOriginProvider === 'youtube' ? refs.sourceOriginProvider : null);
      this.sourceLinkDraft.set(typeof refs.sourceLink === 'string' ? refs.sourceLink.slice(0, 2048) : '');
      if (this.sourceLinkDraft()) {
        const savedStepRequiresMedia = refs.creatorStep === 'configuration' || refs.creatorStep === 'generation' || refs.creatorStep === 'review';
        const restoredMode = refs.sourceMode === 'file' || refs.sourceMode === 'link'
          ? refs.sourceMode
          : savedStepRequiresMedia && this.uploadId ? 'file' : 'link';
        this.sourceMode.set(restoredMode);
        this.linkPreviewOpened.set(true);
      }
      if (refs.creatorStep === 'source' || refs.creatorStep === 'configuration' || refs.creatorStep === 'generation' || refs.creatorStep === 'review')
        this.resumeCreatorStep.set(refs.creatorStep);
      this.restoreConfiguration(refs.configuration);
      this.resumeConfiguration = refs.configuration ?? null;
      this.resultKind.set(this.manualProcessingId && !this.pipelineId ? 'manual' : 'pipeline');
      // Pipeline status has no upload provenance; never trust that link from browser storage.
      this.pipelineUploadId = "";
      this.manualProcessingUploadId = '';
    } catch {
      /* Ignore an invalid or unavailable local resume reference. */
    }
  }
  private restoreConfiguration(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const saved = value as {
      generationMode?: unknown;
      clipTitle?: unknown;
      clipCount?: unknown;
      limitClipDuration?: unknown;
      maxDurationSeconds?: unknown;
      startSeconds?: unknown;
      endSeconds?: unknown;
      aspect?: unknown;
      language?: unknown;
      contentType?: unknown; selectionInstructions?: unknown;
      includeSubtitles?: unknown;
      subtitleStyle?: unknown;
    };
    if (typeof saved.selectionInstructions === 'string') this.selectionInstructions = saved.selectionInstructions.slice(0,2000);
    if (saved.generationMode === 'manual' || saved.generationMode === 'automatic') this.generationMode = saved.generationMode;
    if (this.sourceOriginProvider() === 'twitch') this.generationMode = 'automatic';
    if (typeof saved.clipTitle === 'string') this.clipTitle = saved.clipTitle.slice(0, 120);
    if (typeof saved.clipCount === 'number' && [1, 2, 3].includes(saved.clipCount)) this.clipCount = saved.clipCount as 1 | 2 | 3;
    if (typeof saved.limitClipDuration === 'boolean') this.limitClipDuration = saved.limitClipDuration;
    if (saved.maxDurationSeconds === null || (typeof saved.maxDurationSeconds === 'number' && [15, 30, 60, 120].includes(saved.maxDurationSeconds)))
      this.maxDurationSeconds = saved.maxDurationSeconds;
    const aspects: readonly Schema<'PipelineSpecDto'>['aspect'][] = ['source', 'vertical', 'square', 'horizontal'];
    if (typeof saved.aspect === 'string' && aspects.includes(saved.aspect as Schema<'PipelineSpecDto'>['aspect'])) this.aspect = saved.aspect as Schema<'PipelineSpecDto'>['aspect'];
    if (saved.language === 'auto' || saved.language === 'es' || saved.language === 'en') this.language = saved.language;
    if (['general', 'tutorial', 'interview', 'gameplay', 'commentary', 'reaction'].includes(String(saved.contentType)))
      this.contentType = saved.contentType as Schema<'AutomaticPipelineSpecDto'>['contentType'];
    if (typeof saved.includeSubtitles === 'boolean') this.includeSubtitles = saved.includeSubtitles;
    if (saved.subtitleStyle && typeof saved.subtitleStyle === 'object') {
      const style = saved.subtitleStyle as { template?: unknown; fontSize?: unknown; position?: unknown };
      if ((style.template === 'clean' || style.template === 'boxed' || style.template === 'bold') &&
          typeof style.fontSize === 'number' && [16, 24, 32].includes(style.fontSize) &&
          (style.position === 'top' || style.position === 'bottom')) {
        this.subtitleStyle = { template: style.template, fontSize: style.fontSize, position: style.position };
      }
    }
    const start = saved.startSeconds, end = saved.endSeconds;
    if (typeof start === 'number' && Number.isFinite(start) && typeof end === 'number' && Number.isFinite(end) &&
        start >= 0 && end > start && end <= (this.sourceDurationSeconds() ?? 300) && end - start <= 120) {
      this.startSeconds = start;
      this.endSeconds = end;
    }
  }
  private clearResumeReferences(): void {
    this.resultKind.set('pipeline');
    this.providerGeneration++;
    this.providerStatus.set(null);
    this.providerLoading.set(false);
    this.providerError.set('');
    this.releaseClipPreview();
    this.sourceFileName.set('');
    this.namedUploadId = '';
    this.uploadedFile = null;
    this.uploadGeneration++;
    this.pipelineGeneration++;
    this.manualProcessingGeneration++;
    clearTimeout(this.timer);
    clearTimeout(this.manualProcessingTimer);
    clearTimeout(this.inspectionTimer);
    this.inspecting.set(false);
    this.pollingPipeline.set(false);
    try { const key = this.storageKey(); if (key) sessionStorage.removeItem(key); } catch { /* Storage is optional. */ }
    this.uploadId = "";
    this.pipelineId = "";
    this.pipelineUploadId = "";
    this.uploadStatus.set(null);
    this.pipeline.set(null);
    this.manualProcessing.set(null);
    this.manualProcessingId = '';
    this.manualProcessingUploadId = '';
    this.sourceLinkDraft.set('');
    this.resumeCreatorStep.set(null);
    this.linkPreviewOpened.set(false);
    this.linkPreviewAvailable.set(false);
  }
  private isAccessFailure(error: unknown): boolean {
    return error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403 || error.status === 404);
  }
  private clearProjectAccess(): void {
    this.clearResumeReferences();
    this.project.set(null);
    this.clipTitle = '';
    this.edits.set([]);
    this.editsLoaded.set(false);
    this.createdDraft.set(null);
    this.createdDraftRequest = '';
    this.handoffNotice.set('');
    if (this.creatorWizardOpen()) this.closeCreatorWizard();
  }
  private switchProject(id: string): void {
    this.clipTitle = '';
    this.reviewFilter.set('all');
    this.resultKind.set('pipeline');
    this.providerGeneration++;
    this.providerStatus.set(null);
    this.providerLoading.set(false);
    this.providerError.set('');
    this.releaseLocalPreview();
    this.releaseClipPreview();
    this.selectionError.set('');
    this.sourceFileName.set('');
    this.namedUploadId = '';
    this.uploadedFile = null;
    this.uploadPhase.set(null);
    this.draggingFile.set(false);
    this.sourceMode.set('file');
    this.linkPreviewOpened.set(false);
    this.sourceLinkDraft.set('');
    this.resumeCreatorStep.set(null);
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
    this.projectLoadError.set('');
    this.uploadError.set("");
    this.uploadFailure.set("");
    this.pipelineError.set("");
    this.manualProcessing.set(null);
    this.manualProcessingId = '';
    this.manualProcessingUploadId = '';
    this.manualProcessingError.set('');
    this.manualProcessingGeneration++;
    clearTimeout(this.manualProcessingTimer);
    this.file = null;
    this.uploadId = "";
    this.pipelineId = "";
    this.pipelineUploadId = "";
    this.intervalUploadId = "";
    this.startSeconds = 0;
    this.endSeconds = 30;
    this.intervalNotice.set('');
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
    if (this.design) return 'Puedes revisar un archivo local en esta vista. Para cargarlo, procesarlo y crear un borrador, abre un proyecto de tu cuenta.';
    if (!this.project() && !this.busy() && this.error()) return 'No se pudo confirmar el acceso al proyecto. Vuelve a consultarlo antes de continuar.';
    const role = this.projectRole();
    if (role === "loading" || role === "loading-project") return "Comprobando el rol del espacio antes de habilitar cambios…";
    if (role === "unavailable") return "No se pudo confirmar tu rol en este espacio. Las acciones de edición permanecen deshabilitadas.";
    if (role === "reader") return "Tienes acceso de lectura. Para cargar, procesar o crear borradores necesitas un rol de editor o superior.";
    return "";
  }
  selectUpload(id: string): void {
    this.continueAfterTwitchImport = false;
    this.creatorStep.set('source');
    this.workbench.set('source');
    this.sourceOriginProvider.set(null);
    if (id.trim() !== this.namedUploadId) { this.sourceFileName.set(''); this.namedUploadId = ''; this.uploadedFile = null; }
    this.uploadId = id;
    this.uploadGeneration++;
    clearTimeout(this.inspectionTimer);
    this.uploadStatus.set(null);
    this.uploadError.set("");
    this.inspecting.set(false);
    this.intervalUploadId = "";
    this.startSeconds = 0;
    this.endSeconds = 30;
    this.intervalNotice.set('');
    this.remember();
  }
  onSourceImported(source: { uploadId: string; title?: string; provider?: 'youtube' | 'twitch' }): void {
    if (!this.canEdit() || this.design || !source.uploadId) return;
    this.file = null;
    this.uploadedFile = null;
    this.releaseLocalPreview();
    this.sourceFileName.set(source.title?.trim() || 'Video importado');
    this.namedUploadId = source.uploadId;
    this.selectUpload(source.uploadId);
    this.sourceFileName.set(source.title?.trim() || 'Video importado');
    this.namedUploadId = source.uploadId;
    this.sourceOriginProvider.set(source.provider ?? 'twitch');
    this.generationMode = 'automatic';
    this.sourceMode.set('file');
    this.creatorStep.set('source');
    this.showWorkbench('source');
    this.continueAfterTwitchImport = true;
    void this.inspect();
  }
  selectPipeline(id: string): void {
    this.resultKind.set('pipeline');
    this.releaseClipPreview();
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
    return !!task?.analysisId && ['succeeded','partial_failed'].includes(task.status) && task.id === this.pipelineId.trim() && this.pipelineUploadId === this.uploadId.trim();
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
    if (this.pipeline()?.status === "failed" || this.pipeline()?.status === "partial_failed" || this.pipeline()?.status === "cancelled") return "Reintentar procesamiento";
    return "Procesar intervalo";
  }
  workflowStatus(step: "source" | "render" | "draft"): string {
    if (step === "source") {
      if (this.intervalReady()) return "Listo";
      if (this.inspected()) return "Duración no disponible";
      const status = this.uploadStatus();
      if (status?.state === "aborted") return "Cancelado";
      if (status?.state === "pending") return "Carga pendiente";
      if (status?.inspection?.status === "failed") return "Revisar archivo";
      if (status?.inspection?.status === "queued" || status?.inspection?.status === "running") return "En inspección";
      return "Pendiente";
    }
    if (step === "render") {
      const manual = this.manualProcessing();
      if (this.resultKind() === 'manual' && manual && this.manualProcessingUploadId === this.uploadId.trim()) {
        if (['queued', 'running'].includes(manual.status)) return 'Generando MP4';
        if (manual.status === 'succeeded') return 'MP4 manual listo';
        if (manual.status === 'failed') return 'No completado';
        if (manual.status === 'cancelled') return 'Cancelado';
      }
      const task = this.pipeline();
      if (task) {
        if (!this.hasKnownPipelineUpload()) return "Vínculo no confirmado";
        if (!this.pipelineMatchesSelectedUpload()) return "Otra carga";
        if (this.pipelineInProgress()) return "En proceso";
        if (task.status === "succeeded") return "Clips disponibles";
        if (task.status === "partial_failed") return "Clips listos con errores";
        if (task.status === "failed") return "No completado";
        if (task.status === "cancelled") return "Cancelado";
      }
      return this.intervalReady() ? "Disponible" : this.inspected() ? "Duración no disponible" : "Tras inspección";
    }
    if (this.pipelineDraftWaiting()) return "Esperando transcripción";
    if (this.hasDraftForSelectedUpload()) return "Borrador listo";
    if (this.edits().length) return "Otros borradores del proyecto";
    return this.intervalReady() ? "Disponible" : this.inspected() ? "Duración no disponible" : "Tras inspección";
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
    return ({ queued: "En cola", audio: "Preparando audio", analysis: "Transcribiendo y seleccionando momentos", render: "Creando clips", stopping: "Cancelación solicitada", succeeded: "Completado", partial_failed: "Completado con errores parciales", failed: "No se pudo completar", cancelled: "Cancelado" } as Record<string, string>)[state] ?? state;
  }
  pipelineFailureMessage(code: string | null | undefined): string {
    const messages: Record<string, string> = {
      TRANSCRIPTION_NOT_CONFIGURED: 'La transcripción local no está disponible, así que todavía no se generaron clips. Puedes continuar con un intervalo manual.',
      SELECTION_NOT_CONFIGURED: 'El servidor no confirmó que la IA esté configurada. No se inició el trabajo; puedes continuar con un intervalo manual o volver a consultar la disponibilidad.',
      OPENAI_API_KEY_MISSING: 'OpenAI no está configurado en este servidor. El administrador debe añadir la clave privada y autorizar un límite de gasto antes de generar clips automáticamente. No se generaron clips; puedes continuar con el recorte manual.',
      AI_BUDGET_NOT_AUTHORIZED: 'La generación automática con IA está bloqueada porque no hay un límite de gasto autorizado para este trabajo. No se generaron clips; puedes continuar con el recorte manual.',
      LOCAL_TRANSCRIPTION_DURATION_LIMIT: 'Este MP4 supera el máximo admitido por Whisper local. Recorta o exporta una fuente más corta, o usa Recorte manual (hasta 120 segundos y sin transcripción).',
      SELECTION_PROVIDER_UNAVAILABLE: 'No se pudo conectar con el proveedor de IA configurado para seleccionar los momentos. No se generaron clips; puedes continuar con el recorte manual.',
      SELECTION_MODEL_MISMATCH: 'El modelo de selección no coincide con la configuración requerida para OpenAI. No se generaron clips; puedes continuar con el recorte manual.',
      PIPELINE_ANALYSIS_STAGE_FAILED: 'Falló la transcripción o selección de momentos. No se marcaron clips como listos; puedes intentar Recorte manual.',
      PIPELINE_MEDIA_STAGE_FAILED: 'El servicio de render no pudo completar este procesamiento. Revisa el estado del servicio antes de volver a intentarlo.',
      PIPELINE_ALL_CLIPS_FAILED: 'El servidor confirmó que ningún clip se completó. No hay archivos listos para revisar o descargar.',
      PIPELINE_SOME_CLIPS_FAILED: 'Algunos clips fallaron. Los clips que sí aparecen como listos siguen disponibles para revisar y descargar.',
      PIPELINE_DEADLINE_EXCEEDED: 'El procesamiento superó el tiempo límite del servidor. Puedes iniciar una solicitud nueva cuando el servicio esté disponible.',
    };
    const message = messages[code ?? ''] ?? 'El servidor no pudo completar el procesamiento. Consulta el código y la actividad para decidir el siguiente paso.';
    return this.manualIntervalAvailable() ? message : message
      .replace(/Puedes continuar con un intervalo manual\./gi, 'Vuelve a intentarlo cuando el servicio esté listo.')
      .replace(/puedes continuar con un intervalo manual o volver a consultar la disponibilidad\./gi, 'vuelve a consultar la disponibilidad del servidor.')
      .replace(/puedes continuar con el recorte manual\./gi, 'vuelve a intentarlo cuando el servicio esté disponible.')
      .replace(/puedes intentar Recorte manual\./gi, 'revisa el estado del servidor y vuelve a intentarlo.')
      .replace(/, o usa Recorte manual \(hasta 120 segundos y sin transcripción\)\./gi, '.');
  }
  useManualFallback(): void {
    if (!this.manualIntervalAvailable() || !this.canEdit() || !this.processingSourceReady() || this.busy()) return;
    this.generationMode = 'manual';
    this.pipelineManualFallbackAvailable.set(false);
    this.pipelineError.set('');
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[name="generationMode"]')?.focus());
  }
  useManualAfterPipelineFailure(): void {
    if (!this.manualIntervalAvailable() || !this.canEdit() || !this.processingSourceReady() || this.busy()) return;
    this.generationMode = 'manual';
    this.goToCreatorStep('configuration', true);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[name="generationMode"]')?.focus());
  }
  canOfferManualFallback(task: Schema<'PipelineStatusDto'>): boolean {
    return this.manualIntervalAvailable() && task.status === 'failed' && this.automaticPipeline(task) && this.pipelineMatchesSelectedUpload() && this.processingSourceReady() &&
      ['TRANSCRIPTION_NOT_CONFIGURED','SELECTION_NOT_CONFIGURED','SELECTION_PROVIDER_UNAVAILABLE','OPENAI_API_KEY_MISSING','AI_BUDGET_NOT_AUTHORIZED','PIPELINE_ANALYSIS_STAGE_FAILED'].includes(task.errorCode ?? '');
  }
  automaticPipeline(task = this.pipeline()): task is Schema<'PipelineStatusDto'> & {spec: Schema<'AutomaticPipelineSpecDto'>} {
    return !!task && 'mode' in task.spec && task.spec.mode === 'automatic';
  }
  pipelineClips(task = this.pipeline()): Schema<'PipelineClipStatusDto'>[] { return task?.clips ?? []; }
  filteredPipelineClips(task = this.pipeline()): Schema<'PipelineClipStatusDto'>[] {
    const clips = this.pipelineClips(task);
    switch (this.reviewFilter()) {
      case 'ready': return clips.filter(clip => clip.status === 'succeeded');
      case 'attention': return clips.filter(clip => clip.status === 'failed' || clip.status === 'cancelled');
      case 'working': return clips.filter(clip => clip.status === 'queued' || clip.status === 'running');
      default: return clips;
    }
  }
  pipelineClipCount(filter: 'all' | 'ready' | 'attention' | 'working', task = this.pipeline()): number {
    const clips = this.pipelineClips(task);
    if (filter === 'ready') return clips.filter(clip => clip.status === 'succeeded').length;
    if (filter === 'attention') return clips.filter(clip => clip.status === 'failed' || clip.status === 'cancelled').length;
    if (filter === 'working') return clips.filter(clip => clip.status === 'queued' || clip.status === 'running').length;
    return clips.length;
  }
  firstReadyPipelineClip(): Schema<'PipelineClipStatusDto'> | undefined {
    return this.pipelineClips().find(clip => clip.status === 'succeeded');
  }
  selectedPipelineClip(task = this.pipeline()): Schema<'PipelineClipStatusDto'> | undefined {
    const index = this.clipPreviewIndex();
    return index === null ? undefined : this.pipelineClips(task).find(clip => clip.index === index);
  }
  draftTitle(clipTitle?: string): string | undefined {
    const collection = this.clipTitle.trim();
    const clip = clipTitle?.trim();
    if (collection && clip && collection.toLocaleLowerCase() !== clip.toLocaleLowerCase()) return `${collection} · ${clip}`.slice(0, 120);
    return (collection || clip || '').slice(0, 120) || undefined;
  }
  pipelineIntervalLabel(task: Schema<'PipelineStatusDto'>): string {
    return 'mode' in task.spec ? 'Selección automática de momentos' : `Intervalo procesado: ${task.spec.startSeconds}–${task.spec.endSeconds} s`;
  }
  clipStateLabel(status: Schema<'PipelineClipStatusDto'>['status']): string {
    return ({queued:'En cola',running:'Generando MP4',succeeded:'Listo',failed:'Falló',cancelled:'Cancelado'} as Record<string,string>)[status] ?? status;
  }
  pipelineProgress(task: Schema<"PipelineStatusDto">) {
    return pipelineProgress(task.status, task.events);
  }
  manualProcessingProgress(task: Schema<'ProcessingStatusDto'>) {
    const terminal = task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled';
    const workerStarted = task.startedAt !== null;
    const queueState = task.status === 'queued'
      ? 'current'
      : terminal && !workerStarted && task.status !== 'succeeded'
        ? task.status === 'failed' ? 'failed' : 'cancelled'
        : 'complete';
    const renderState = task.status === 'queued'
      ? 'pending'
      : task.status === 'running'
        ? 'current'
        : task.status === 'succeeded'
          ? 'complete'
          : workerStarted && terminal
            ? task.status === 'failed' ? 'failed' : 'cancelled'
            : 'pending';
    const stateLabel = (state: string) => ({
      complete: 'Listo', current: 'En curso', pending: 'Pendiente', failed: 'No completado', cancelled: 'Cancelado',
    } as Record<string, string>)[state] ?? 'Pendiente';
    return [
      { id: 'request', label: 'Solicitud recibida', state: 'complete', status: stateLabel('complete') },
      { id: 'queue', label: 'Cola de trabajo', state: queueState, status: stateLabel(queueState) },
      { id: 'render', label: 'Crear MP4', state: renderState, status: stateLabel(renderState) },
    ];
  }
  sourceOriginLabel(): string {
    const uploadId = this.uploadId.trim();
    if (!uploadId) return "No hay un archivo cargado seleccionado";
    if (this.sourceOriginProvider() === 'twitch' && this.namedUploadId === uploadId)
      return `Clip importado de Twitch: ${this.sourceFileName() || 'clip autorizado'}`;
    if (this.sourceFileName() && this.namedUploadId === uploadId)
      return `Archivo cargado: ${this.sourceFileName()}`;
    return `Archivo cargado · ${uploadId.slice(0, 8)}`;
  }
  eventStateLabel(state: string): string {
    return ({ queued: "En cola", audio: "Preparando audio", analysis: "Transcribiendo", render: "Creando el clip", stopping: "Cancelación solicitada", succeeded: "Completado", failed: "Error", cancelled: "Cancelado" } as Record<string, string>)[state] ?? state;
  }
  choose(event: Event): void {
    if (this.busy() || (!this.design && !this.canEdit())) return;
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.selectFile(file);
  }
  onFileDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    if (!this.busy() && (this.design || this.canEdit())) this.draggingFile.set(true);
  }
  onFileDragLeave(event: DragEvent): void {
    const zone = event.currentTarget;
    if (zone instanceof HTMLElement && event.relatedTarget instanceof Node && zone.contains(event.relatedTarget)) return;
    this.draggingFile.set(false);
  }
  onFileDrop(event: DragEvent, input: HTMLInputElement): void {
    event.preventDefault();
    this.draggingFile.set(false);
    if (this.busy() || (!this.design && !this.canEdit())) return;
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    if (files.length !== 1) {
      this.selectionError.set('Arrastra un solo video a la vez.');
      return;
    }
    input.value = '';
    this.selectFile(files[0]);
  }
  private selectFile(file: File): void {
    this.releaseLocalPreview();
    this.file = file;
    this.selectionError.set('');
    this.uploadFailure.set('');
    try { uploadContentType(file); }
    catch (error) { this.selectionError.set(error instanceof Error ? error.message : 'Selecciona un archivo de video compatible.'); return; }
    try { this.localPreview.set(URL.createObjectURL(file)); }
    catch { this.previewUnavailable.set(true); }
  }
  clearSelectedFile(input: HTMLInputElement): void {
    if (this.busy()) return;
    this.releaseLocalPreview();
    this.file = null;
    this.selectionError.set('');
    this.uploadFailure.set('');
    this.draggingFile.set(false);
    input.value = '';
    input.focus();
  }
  prepareInspectionRetry(input: HTMLInputElement): void {
    if (this.busy() || !this.canEdit()) return;
    this.releaseLocalPreview();
    this.file = null;
    this.selectionError.set('');
    this.uploadFailure.set('');
    this.draggingFile.set(false);
    input.value = '';
    this.message.set('La inspección de esta carga terminó y no tiene reintento. Elige el archivo otra vez para crear una carga nueva.');
    input.focus();
  }
  private releaseLocalPreview(): void {
    const url = this.localPreview();
    if (url) URL.revokeObjectURL(url);
    this.localPreview.set('');
    this.previewUnavailable.set(false);
  }
  hasUnuploadedSelection(): boolean { return !!this.file && this.file !== this.uploadedFile; }
  sourceStageIndex(): number {
    if (this.uploading()) return this.uploadPhase() === 'transferring' ? 1 : this.uploadPhase() === 'confirming' ? 2 : 0;
    const status = this.uploadStatus();
    if (this.intervalReady()) return 3;
    if (status?.state === 'confirmed') return 2;
    if (status?.state === 'pending') return 1;
    return -1;
  }
  setIntervalField(field: 'startSeconds' | 'endSeconds', value: number | null): void {
    if (this.busy() || !this.canEdit() || !this.processingSourceReady()) return;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this[field] = Number.NaN;
      this.intervalNotice.set('');
      return;
    }
    const maximum = this.sourceSelectionLimitSeconds();
    if (field === 'startSeconds') {
      const currentEnd = Number.isFinite(this.endSeconds) ? this.endSeconds : maximum;
      const lower = Math.max(0, currentEnd - 120);
      const upper = Math.max(lower, Math.min(maximum - 0.1, currentEnd - 0.1));
      this.startSeconds = Math.min(upper, Math.max(lower, value));
    } else {
      const currentStart = Number.isFinite(this.startSeconds) ? this.startSeconds : 0;
      const lower = Math.min(maximum, currentStart + 0.1);
      const upper = Math.max(lower, Math.min(maximum, currentStart + 120));
      this.endSeconds = Math.min(upper, Math.max(lower, value));
    }
    this.intervalNotice.set(this[field] === value ? '' : `El ${field === 'startSeconds' ? 'inicio' : 'fin'} se ajustó al intervalo permitido por la duración inspeccionada (${maximum} s).`);
  }
  async reload(): Promise<void> {
    if (this.design || this.busy()) return;
    const generation = this.projectGeneration;
    const editsRequest = ++this.editsGeneration;
    const projectId = this.id;
    this.editsLoading.set(true);
    this.projectLoadError.set('');
    await this.run(async () => {
      this.loadNotice.set("");
      const [projectResult, editsResult] = await Promise.allSettled([
        this.api.get(projectId),
        this.api.edits(projectId),
      ]);
      if (!this.isCurrentProject(generation)) return;
      if (projectResult.status === "rejected") {
        if (this.isAccessFailure(projectResult.reason)) this.clearProjectAccess();
        this.projectLoadError.set(errorMessage(projectResult.reason));
        this.editsError.set('No se pudo confirmar el acceso al proyecto para mostrar sus borradores.');
        throw projectResult.reason;
      }
      if (projectResult.value.id !== projectId) {
        this.projectLoadError.set('La respuesta no corresponde al proyecto solicitado. Vuelve a consultar el proyecto.');
        throw new Error(this.projectLoadError());
      }
      this.project.set(projectResult.value);
      if (!this.clipTitle.trim()) this.clipTitle = projectResult.value.name;
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
    this.openCreatorWizardFromNavigation();
    if (this.isCurrentProject(generation) && editsRequest === this.editsGeneration) this.editsLoading.set(false);
    if (!this.isCurrentProject(generation)) return;
    if (this.uploadId) await this.inspect();
    if (!this.isCurrentProject(generation)) return;
    if (this.pipelineId) await this.pollPipeline();
    if (this.manualProcessingId) await this.pollManualProcessing();
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
        if (this.isAccessFailure(error)) {
          this.clearProjectAccess();
          this.projectLoadError.set(errorMessage(error));
        }
        this.editsError.set(`No se pudieron cargar los borradores: ${errorMessage(error)}`);
      }
    } finally {
      if (this.isCurrentProject(generation) && request === this.editsGeneration) this.editsLoading.set(false);
    }
  }
  async upload(): Promise<void> {
    if (!this.file || this.busy() || !this.canEdit()) return;
    if (!this.hasUnuploadedSelection()) {
      this.message.set('Este archivo ya está asociado a una carga confirmada. Selecciona otro archivo para iniciar una nueva carga.');
      return;
    }
    if (this.uploadBlocked()) {
      this.uploadError.set(this.uploadRecoveryLabel() || 'Consulta o libera la carga anterior antes de volver a transferir.');
      return;
    }
    try { uploadContentType(this.file); }
    catch (error) { this.selectionError.set(error instanceof Error ? error.message : 'Selecciona un video compatible.'); return; }
    this.selectionError.set('');
    this.uploadFailure.set('');
    const generation = this.projectGeneration;
    const file = this.file;
    let createdIntent = false;
    const controller = new AbortController();
    this.activeUploadController = controller;
    this.activeUploadId = "";
    this.cancellingUpload.set(false);
    this.uploading.set(true);
    this.uploadPhase.set('hashing');
    await this.run(async () => {
      const status = await this.api.uploadFile(
        this.id,
        file,
        (stage, phase) => { if (this.isCurrentProject(generation)) { this.message.set(stage); if (phase) this.uploadPhase.set(phase); } },
        (id) => {
          if (!this.isCurrentProject(generation)) return;
          createdIntent = true;
          this.activeUploadId = id;
          this.selectUpload(id);
          this.remember();
        },
        controller.signal,
      );
      if (!this.isCurrentProject(generation)) return;
      if (status.id !== this.uploadId.trim() || status.projectId !== this.id)
        throw new Error('La respuesta de carga no corresponde al proyecto y al ID consultados.');
      this.uploadStatus.set(status);
      if (status.state === 'confirmed' && this.uploadId.trim() === status.id) {
        this.namedUploadId = status.id;
        this.sourceFileName.set(file.name);
        this.uploadedFile = file;
      }
      this.message.set(
        "Carga confirmada. Consulta abajo el estado de inspección antes de continuar.",
      );
    });
    if (this.isCurrentProject(generation) && this.error()) {
      this.uploadFailure.set(this.error());
      this.error.set('');
    }
    if (this.activeUploadController && this.activeUploadController.signal.aborted && !this.cancellingUpload()) {
      this.activeUploadController = undefined;
      this.activeUploadId = "";
    }
    if (!this.isCurrentProject(generation)) return;
    this.uploading.set(false);
    this.uploadPhase.set(null);
    this.activeUploadController = undefined;
    this.activeUploadId = "";
    if (this.uploadStatus() || (createdIntent && this.uploadId.trim())) await this.inspect();
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
      if (status.id !== id || status.projectId !== this.id)
        throw new Error("La carga consultada no corresponde al ID y proyecto solicitados.");
      this.uploadStatus.set(status);
      this.uploadError.set("");
      if (this.continueAfterTwitchImport && this.sourceMode() === 'file' && this.intervalReady()) {
        this.continueAfterTwitchImport = false;
        this.goToCreatorStep('configuration', true);
      }
      const duration = status.inspection?.result?.durationSeconds;
      if (status.inspection?.status === "succeeded" && this.intervalUploadId !== id) {
        this.startSeconds = 0;
        this.endSeconds = Math.max(0.1, Math.min(30, duration ?? 30, 300));
        this.intervalUploadId = id;
      }
      if (this.resumeConfiguration !== null) {
        this.restoreConfiguration(this.resumeConfiguration);
        this.resumeConfiguration = null;
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
    if (this.sourceDurationSeconds() === null) throw new Error('No se confirmó la duración del medio; vuelve a inspeccionar la fuente antes de continuar.');
    if (!this.processingSourceReady()) throw new Error('Elige explícitamente un MP4 inspeccionado como fuente de procesamiento antes de continuar.');
    if (
      !Number.isFinite(this.startSeconds) ||
      !Number.isFinite(this.endSeconds) ||
      this.startSeconds < 0 ||
      this.endSeconds - this.startSeconds < 0.1 ||
      this.endSeconds - this.startSeconds > 120 ||
        this.endSeconds > this.sourceSelectionLimitSeconds()
    )
      throw new Error(`El intervalo debe durar entre 0,1 y 120 segundos y quedar dentro de los ${this.sourceSelectionLimitSeconds()} segundos inspeccionados.`);
  }
  async startPipeline(): Promise<void> {
    if (!this.canEdit()) return;
    const generation = this.projectGeneration;
    await this.run(async () => {
      this.pipelineError.set('');
      this.pipelineManualFallbackAvailable.set(false);
      if (this.pollingPipeline() || this.pipelineBlocksSelectedUpload()) throw new Error("Ya hay un procesamiento activo para esta carga. Espera a que termine o solicita su cancelación.");
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
      let result: Schema<"PipelineStatusDto">;
      try { result = await this.api.createPipeline(uploadId, body, this.pipelineKey); }
      catch (error) {
        await this.setPipelineStartError(error, generation);
        throw error;
      }
      if (!this.isCurrentProject(generation) || this.uploadId.trim() !== uploadId) return;
      this.selectPipeline(result.id);
      this.pipelineUploadId = uploadId;
      this.pipeline.set(result);
      this.pipelineId = result.id;
      this.creatorStep.set('generation');
      this.remember();
      this.pipelineKey = "";
      this.pipelineBody = "";
    });
    if (this.pipelineId) await this.pollPipeline();
  }
  async startAutomaticPipeline(): Promise<void> {
    if (!this.canEdit() || !this.processingSourceReady() || this.design || this.busy()) return;
    if (!this.localAutomaticSelectionReady()) {
      this.pipelineError.set(this.pipelineFailureMessage('SELECTION_NOT_CONFIGURED'));
      return;
    }
    const generation = this.projectGeneration;
    await this.run(async () => {
      if (this.pollingPipeline() || this.pipelineBlocksSelectedUpload()) throw new Error('Ya hay un procesamiento activo para esta carga. Espera a que termine o solicita su cancelación.');
      const manual = this.manualProcessing();
      if (this.manualProcessingUploadId === this.uploadId.trim() && manual && ['queued','running'].includes(manual.status)) throw new Error('Ya hay un render manual en curso para esta carga. Espera o cancélalo antes de iniciar otro.');
      const uploadId = this.uploadId.trim();
      const count = Number(this.clipCount);
      const maximum = this.limitClipDuration && this.maxDurationSeconds != null ? Number(this.maxDurationSeconds) : undefined;
      if (!Number.isInteger(count) || count < 1 || count > 3) throw new Error('Elige entre 1 y 3 clips.');
      if (maximum !== undefined && (!Number.isInteger(maximum) || maximum < 1 || maximum > 120)) throw new Error('El límite de duración debe ser de 1 a 120 segundos.');
      const body: Schema<'AutomaticPipelineSpecDto'> = {
        version: 2, mode: 'automatic', provider: 'whisper_cpp', selectionMode: 'llm', language: this.language,
        clipCount: count, ...(maximum === undefined ? {} : {maxDurationSeconds: maximum}),
        // The model selects transcript-grounded timestamps; FFmpeg renders those exact intervals.
        contentType: this.contentType, instructions: this.selectionInstructions.trim(), aspect: this.aspect,
        subtitles: this.includeSubtitles ? {source:'transcript',style:this.subtitleStyle} : {source:'none'},
      };
      const serialized = JSON.stringify({uploadId,body});
      if (serialized !== this.pipelineBody) { this.pipelineBody = serialized; this.pipelineKey = crypto.randomUUID(); }
      this.pipelineError.set('');
      this.pipelineManualFallbackAvailable.set(false);
      let result: Schema<'PipelineStatusDto'>;
      try { result = await this.api.createPipeline(uploadId,body,this.pipelineKey); }
      catch (error) { await this.setPipelineStartError(error, generation); throw error; }
      if (!this.isCurrentProject(generation) || this.uploadId.trim() !== uploadId) return;
      this.selectPipeline(result.id);
      this.pipelineUploadId = uploadId;
      this.pipeline.set(result);
      this.pipelineId = result.id;
      this.creatorStep.set('generation');
      this.remember();
      this.pipelineKey = ''; this.pipelineBody = '';
    });
    if (this.pipelineId) await this.pollPipeline();
  }
  private async setPipelineStartError(error: unknown, generation: number): Promise<void> {
    if (!(error instanceof HttpErrorResponse)) return;
    const code = (error.error as {code?: string} | null)?.code;
    if (code === 'LOCAL_TRANSCRIPTION_DURATION_LIMIT' && error.status === 400) {
      this.pipelineError.set(this.pipelineFailureMessage(code));
      this.pipelineManualFallbackAvailable.set(this.manualIntervalAvailable());
      try {
        const status = await this.api.analysisProviders();
        if (!this.isCurrentProject(generation)) return;
        const limit = status.transcription.whisper_cpp.maxSeconds;
        if (Number.isFinite(limit) && limit > 0) this.pipelineError.set(this.manualIntervalAvailable()
          ? `Este MP4 dura más que el máximo de ${limit} segundos de Whisper local. Exporta o recorta una fuente de ${limit} segundos o menos, o cambia a Recorte manual (hasta 120 segundos, sin transcripción).`
          : `Este video dura más que el máximo de ${limit} segundos de Whisper local. Exporta una fuente más corta y vuelve a intentarlo.`);
      } catch { /* Keep the actionable duration-limit message when provider diagnostics are unavailable. */ }
      return;
    }
    if (error.status === 503 && code === 'TRANSCRIPTION_NOT_CONFIGURED') {
      this.pipelineError.set(this.pipelineFailureMessage(code));
      this.pipelineManualFallbackAvailable.set(this.manualIntervalAvailable());
      return;
    }
    if (error.status === 503 && ['SELECTION_NOT_CONFIGURED','OPENAI_API_KEY_MISSING','AI_BUDGET_NOT_AUTHORIZED','SELECTION_PROVIDER_UNAVAILABLE','SELECTION_MODEL_MISMATCH'].includes(code ?? '')) {
      const detail = code === 'OPENAI_API_KEY_MISSING' ? 'Falta configurar la clave de OpenAI en el servidor.' : code === 'AI_BUDGET_NOT_AUTHORIZED' ? 'Falta un presupuesto autorizado para usar la IA.' : 'El proveedor de IA no está disponible o configurado.';
      this.pipelineError.set(`${detail} No se generaron clips ni se sustituyó la selección por recortes arbitrarios.${this.manualIntervalAvailable() ? ' Puedes usar el recorte manual.' : ''}`);
      this.pipelineManualFallbackAvailable.set(this.manualIntervalAvailable());
    }
  }
  async startManualProcessing(): Promise<void> {
    if (!this.canEdit() || !this.processingSourceReady() || this.design || this.busy() || this.manualProcessingBusy()) return;
    const generation = this.projectGeneration;
    await this.run(async () => {
      const uploadId = this.uploadId.trim();
      this.validateInterval();
      if (this.pipelineBlocksSelectedUpload()) throw new Error('Hay una transcripción automática en curso para esta carga. Espera o cancélala antes de iniciar otro procesamiento.');
      const priorManual = this.manualProcessing();
      if (this.manualProcessingUploadId === uploadId && priorManual && ['queued', 'running'].includes(priorManual.status)) throw new Error('Ya hay un render manual en curso para esta carga. Espera o cancélalo antes de iniciar otro.');
      const body: Schema<'ClipProcessingSpecDto'> = {
        version: 1, kind: 'clip', startSeconds: this.startSeconds, endSeconds: this.endSeconds, aspect: this.aspect,
      };
      const serialized = JSON.stringify({ uploadId, body });
      if (serialized !== this.manualProcessingBody) {
        this.manualProcessingBody = serialized;
        this.manualProcessingKey = crypto.randomUUID();
      }
      this.manualProcessingBusy.set(true);
      this.manualProcessingError.set('');
      this.pipelineError.set('');
      try {
        const result = await this.api.createProcessing(uploadId, body, this.manualProcessingKey);
        if (!this.isCurrentProject(generation) || this.uploadId.trim() !== uploadId) return;
        if (!result.id) throw new Error('El servidor no devolvió el identificador del procesamiento.');
        this.releaseClipPreview();
        this.manualProcessingId = result.id;
        this.resultKind.set('manual');
        this.manualProcessingUploadId = uploadId;
        this.manualProcessing.set(null);
        this.creatorStep.set('generation');
        this.pipelineError.set('');
        this.manualProcessingKey = '';
        this.manualProcessingBody = '';
        this.remember();
        await this.pollManualProcessing();
      } finally { this.manualProcessingBusy.set(false); }
    });
  }
  async pollManualProcessing(): Promise<void> {
    clearTimeout(this.manualProcessingTimer);
    const id = this.manualProcessingId.trim();
    if (this.design || !id) return;
    const projectGeneration = this.projectGeneration;
    const generation = ++this.manualProcessingGeneration;
    this.manualProcessingBusy.set(true);
    this.manualProcessingError.set('');
    try {
      const result = await this.api.processing(id);
      if (generation !== this.manualProcessingGeneration || !this.isCurrentProject(projectGeneration)) return;
      if (result.id !== id) throw new Error('La respuesta no corresponde al procesamiento consultado.');
      if (this.resultKind() === 'manual' && result.status !== 'succeeded' && this.clipPreviewUrl()) this.releaseClipPreview();
      this.manualProcessing.set(result);
      if (this.resultKind() === 'manual' && this.creatorStep() === 'generation' && this.workbench() === 'processing' && ['succeeded','failed','cancelled'].includes(result.status)) this.creatorStep.set('review');
      if (result.status === 'queued' || result.status === 'running') this.manualProcessingTimer = setTimeout(() => void this.pollManualProcessing(), 3000);
    } catch (error) {
      if (generation === this.manualProcessingGeneration && this.isCurrentProject(projectGeneration)) {
        if (this.isAccessFailure(error)) this.clearResumeReferences();
        this.manualProcessingError.set(errorMessage(error));
      }
    } finally {
      if (generation === this.manualProcessingGeneration && this.isCurrentProject(projectGeneration)) this.manualProcessingBusy.set(false);
    }
  }
  async cancelManualProcessing(): Promise<void> {
    const id = this.manualProcessingId.trim();
    if (!id || !this.canEdit() || this.busy()) return;
    await this.run(async () => {
      await this.api.cancelProcessing(id);
      await this.pollManualProcessing();
    });
  }
  async previewManualProcessing(): Promise<void> {
    const task = this.manualProcessing();
    if (this.design || this.resultKind() !== 'manual' || this.clipPreviewLoading() || !task || task.id !== this.manualProcessingId.trim() || task.status !== 'succeeded') return;
    this.releaseClipPreview();
    const generation = this.clipPreviewGeneration, project = this.projectGeneration;
    const isCurrent = () => generation === this.clipPreviewGeneration && this.isCurrentProject(project) && this.resultKind() === 'manual' && this.manualProcessingId.trim() === task.id;
    this.clipPreviewLoading.set(true);
    try {
      const result = await this.api.processingDownload(task.id, 'video');
      if (!isCurrent()) return;
      const media = await fetchPrivateArtifact(result.url);
      if (!isCurrent()) return;
      this.clipPreviewUrl.set(URL.createObjectURL(media));
    } catch (error) {
      if (isCurrent()) this.clipPreviewError.set(errorMessage(error));
    } finally {
      if (isCurrent()) this.clipPreviewLoading.set(false);
    }
  }
  async downloadManualProcessing(): Promise<void> {
    const task = this.manualProcessing();
    if (!task || task.id !== this.manualProcessingId.trim() || task.status !== 'succeeded') return;
    const generation = this.projectGeneration;
    await this.run(async () => {
      const result = await this.api.processingDownload(task.id, 'video');
      if (!this.isCurrentProject(generation) || this.resultKind() !== 'manual' || this.manualProcessingId.trim() !== task.id || this.manualProcessing()?.id !== task.id || this.manualProcessing()?.status !== 'succeeded') return;
      await downloadPrivateArtifact(result.url, `autoclipper-${task.id}.mp4`);
    });
  }
  async editManualProcessingResult(): Promise<void> {
    const task = this.manualProcessing();
    if (!task || task.id !== this.manualProcessingId.trim() || task.status !== 'succeeded' || this.manualProcessingUploadId !== this.uploadId.trim() || !this.processingSourceReady() || !this.canEdit() || this.busy()) return;
    this.startSeconds = task.spec.startSeconds ?? this.startSeconds;
    this.endSeconds = task.spec.endSeconds ?? this.endSeconds;
    this.aspect = task.spec.aspect ?? this.aspect;
    this.showWorkbench('drafts');
    const subtitles: EditorSubtitles = task.spec.subtitles ? { source: 'user', cues: structuredClone(task.spec.subtitles.cues), ...(task.spec.subtitles.style ? {style:{...task.spec.subtitles.style}} : {}) } : { source: 'none' };
    await this.createEdit(subtitles);
  }
  async retryPipelineResult(): Promise<void> {
    const task = this.pipeline();
    if (!task || task.id !== this.pipelineId.trim() || !['failed', 'cancelled'].includes(task.status) || !this.pipelineMatchesSelectedUpload() || !this.processingSourceReady() || !this.canEdit() || this.busy()) return;
    if ('mode' in task.spec) return;
    this.startSeconds = task.spec.startSeconds;
    this.endSeconds = task.spec.endSeconds;
    this.aspect = task.spec.aspect;
    this.language = task.spec.language;
    await this.startPipeline();
  }
  async pollPipeline(retryCount = 0): Promise<void> {
    clearTimeout(this.timer);
    if (this.design || !this.pipelineId) return;
    const projectGeneration = this.projectGeneration;
    const id = this.pipelineId.trim(), generation = ++this.pipelineGeneration;
    this.pollingPipeline.set(true);
    this.pipelineError.set("");
    try {
      const task = await this.api.pipeline(id);
      if (generation !== this.pipelineGeneration || !this.isCurrentProject(projectGeneration)) return;
      if (task.id !== id) throw new Error('La respuesta no corresponde al pipeline consultado.');
      const previewIndex = this.clipPreviewIndex();
      const previewClipStillReady = previewIndex !== null && task.clips?.some((clip) => clip.index === previewIndex && clip.status === 'succeeded');
      if (!['succeeded','partial_failed'].includes(task.status) && this.clipPreviewUrl() && !previewClipStillReady) this.releaseClipPreview();
      this.pipeline.set(task);
      if (this.resultKind() === 'pipeline' && this.creatorStep() === 'generation' && this.workbench() === 'processing' && ['succeeded','partial_failed','failed','cancelled'].includes(task.status)) this.creatorStep.set('review');
      this.pipelineError.set("");
      this.remember();
      if (
        !this.disposed &&
        !["succeeded", "partial_failed", "failed", "cancelled"].includes(task.status)
      )
        this.timer = setTimeout(() => void this.pollPipeline(), 4000);
    } catch (error) {
      if (generation !== this.pipelineGeneration || !this.isCurrentProject(projectGeneration)) return;
      if (this.isAccessFailure(error)) this.clearResumeReferences();
      const retryable = error instanceof HttpErrorResponse && [0, 500, 502, 503, 504].includes(error.status);
      if (retryable && retryCount < 2) {
        this.pipelineError.set('Se interrumpió la consulta del progreso. Volveremos a consultar el mismo trabajo.');
        this.timer = setTimeout(() => void this.pollPipeline(retryCount + 1), 4000 * (retryCount + 1));
      } else {
        this.pipelineError.set(errorMessage(error));
      }
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
  async previewPipelineClip(index: number): Promise<void> {
    const id = this.pipelineId.trim();
    const task = this.pipeline();
    const clip = task?.clips?.find((item) => item.index === index);
    if (this.design || this.clipPreviewLoading() || task?.id !== id || clip?.status !== 'succeeded') return;
    this.releaseClipPreview();
    this.clipPreviewIndex.set(index);
    const generation = this.clipPreviewGeneration;
    const projectGeneration = this.projectGeneration;
    this.clipPreviewLoading.set(true);
    try {
      const result = await this.api.pipelineClipDownload(id,index,'video');
      if (!this.isCurrentClipPreview(generation,projectGeneration,id,index)) return;
      const video = await fetchPrivateArtifact(result.url);
      if (!this.isCurrentClipPreview(generation,projectGeneration,id,index)) return;
      this.clipPreviewUrl.set(URL.createObjectURL(video));
      this.clipPreviewIndex.set(index);
    } catch (error) {
      if (this.isCurrentClipPreview(generation,projectGeneration,id,index)) this.clipPreviewError.set(errorMessage(error));
    } finally {
      if (generation === this.clipPreviewGeneration && this.isCurrentProject(projectGeneration)) this.clipPreviewLoading.set(false);
    }
  }
  async downloadPipelineClip(index: number, kind: 'video' | 'srt' | 'vtt' = 'video'): Promise<void> {
    const id = this.pipelineId.trim();
    const clip = this.pipeline()?.clips?.find((item) => item.index === index);
    if (this.pipeline()?.id !== id || clip?.status !== 'succeeded') return;
    const generation = this.projectGeneration;
    await this.run(async () => {
      const result = await this.api.pipelineClipDownload(id,index,kind);
      if (!this.isCurrentProject(generation) || this.pipelineId.trim() !== id || this.pipeline()?.id !== id || this.pipeline()?.clips?.find((item) => item.index === index)?.status !== 'succeeded') return;
      await downloadPrivateArtifact(result.url,`autoclipper-${id}-clip-${index + 1}.${kind === 'video' ? 'mp4' : kind}`);
    });
  }
  async editPipelineClip(index: number): Promise<void> {
    const task = this.pipeline();
    const clip = task?.clips?.find((item) => item.index === index);
    if (!task || task.id !== this.pipelineId.trim() || !['succeeded','partial_failed'].includes(task.status) || !this.automaticPipeline(task) || clip?.status !== 'succeeded' || !this.pipelineMatchesSelectedUpload() || !this.processingSourceReady() || !this.canEdit() || this.busy()) return;
    if (task.spec.subtitles.source === 'transcript' && !this.hasLinkedTranscript()) {
      this.error.set('El clip incluye subtítulos, pero falta confirmar su transcripción de origen. Actualiza el estado antes de abrir el editor.');
      return;
    }
    this.startSeconds = clip.startSeconds;
    this.endSeconds = clip.endSeconds;
    this.aspect = task.spec.aspect;
    this.language = task.spec.language;
    this.showWorkbench('drafts');
    await this.createEdit(this.pipelineEditorSubtitles(), clip.title);
  }
  async previewPipeline(): Promise<void> {
    const id = this.pipelineId.trim();
    if (this.design || this.clipPreviewLoading() || this.pipeline()?.id !== id || this.pipeline()?.status !== 'succeeded') return;
    this.releaseClipPreview();
    const generation = this.clipPreviewGeneration;
    const projectGeneration = this.projectGeneration;
    this.clipPreviewLoading.set(true);
    try {
      const result = await this.api.pipelineDownload(id, 'video');
      if (!this.isCurrentClipPreview(generation, projectGeneration, id)) return;
      const video = await fetchPrivateArtifact(result.url);
      if (!this.isCurrentClipPreview(generation, projectGeneration, id)) return;
      this.clipPreviewUrl.set(URL.createObjectURL(video));
    } catch (error) {
      if (this.isCurrentClipPreview(generation, projectGeneration, id)) this.clipPreviewError.set(errorMessage(error));
    } finally {
      if (generation === this.clipPreviewGeneration && this.isCurrentProject(projectGeneration)) this.clipPreviewLoading.set(false);
    }
  }
  closeClipPreview(): void { this.releaseClipPreview(); }
  clipPreviewPlaybackFailed(): void {
    this.releaseClipPreview();
    this.clipPreviewError.set('El MP4 no se pudo reproducir en este navegador. Descárgalo o solicita otra vista previa.');
  }
  private isCurrentClipPreview(generation: number, projectGeneration: number, id: string, index?: number): boolean {
    const task = this.pipeline();
    const available = index === undefined
      ? !!task && ['succeeded','partial_failed'].includes(task.status)
      : !!task?.clips?.some((clip) => clip.index === index && clip.status === 'succeeded');
    return generation === this.clipPreviewGeneration && this.isCurrentProject(projectGeneration) && this.pipelineId.trim() === id && task?.id === id && available;
  }
  private releaseClipPreview(): void {
    this.clipPreviewGeneration++;
    const url = this.clipPreviewUrl();
    if (url) URL.revokeObjectURL(url);
    this.clipPreviewUrl.set('');
    this.clipPreviewIndex.set(null);
    this.clipPreviewError.set('');
    this.clipPreviewLoading.set(false);
  }
  async createEdit(subtitles?: EditorSubtitles, name?: string): Promise<void> {
    if (!this.canEdit()) return;
    const generation = this.projectGeneration;
    await this.run(async () => {
      if (this.pipelineDraftWaiting()) throw new Error('Espera a que termine el procesamiento de esta carga para vincular al borrador su transcripción real.');
      if (!this.processingSourceReady()) throw new Error('Elige explícitamente un MP4 inspeccionado como fuente antes de crear un borrador.');
      const uploadId = this.uploadId.trim();
      this.validateInterval();
      const body = this.draftRequestBody(subtitles, this.draftTitle(name));
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
  async editPipelineResult(): Promise<void> {
    const task = this.pipeline();
    if (!task || task.id !== this.pipelineId.trim() || !['succeeded','partial_failed'].includes(task.status) || !this.pipelineMatchesSelectedUpload() || !this.processingSourceReady() || !this.canEdit() || this.busy()) return;
    if ('mode' in task.spec) {
      const firstReadyClip = task.clips?.find((clip) => clip.status === 'succeeded');
      if (firstReadyClip) await this.editPipelineClip(firstReadyClip.index);
      return;
    }
    // The visible result uses its submitted spec, not potentially changed form fields.
    this.startSeconds = task.spec.startSeconds;
    this.endSeconds = task.spec.endSeconds;
    this.aspect = task.spec.aspect;
    this.language = task.spec.language;
    this.showWorkbench('drafts');
    await this.createEdit();
  }
  async continueToEditor(): Promise<void> {
    if (this.resultKind() === 'manual' && this.manualProcessing()?.status === 'succeeded') { await this.editManualProcessingResult(); return; }
    const task = this.pipeline();
    if (task && ['succeeded','partial_failed'].includes(task.status) && task.id === this.pipelineId.trim() && this.pipelineMatchesSelectedUpload()) {
      await this.editPipelineResult();
      return;
    }
    await this.createEdit();
  }
  private pipelineEditorSubtitles(): EditorSubtitles {
    const task = this.pipeline();
    if (task && this.automaticPipeline(task) && task.spec.subtitles.source === 'none') return { source: 'none' };
    const analysisId = this.hasLinkedTranscript() ? this.pipeline()?.analysisId : null;
    if (!analysisId) return { source: 'none' };
    const style = task && this.automaticPipeline(task) && task.spec.subtitles.source === 'transcript' ? task.spec.subtitles.style : undefined;
    return {source:'transcript',analysisId,...(style ? {style:{...style}} : {})};
  }
  private draftRequestBody(subtitles?: EditorSubtitles, name?: string): Schema<'CreateEditDto'> {
    return { name: name?.trim().slice(0, 120) || `Clip ${this.startSeconds}–${this.endSeconds}s`, spec: {
      version: 1, kind: 'clip', startSeconds: this.startSeconds, endSeconds: this.endSeconds, aspect: this.aspect,
      subtitles: subtitles ?? this.pipelineEditorSubtitles(),
    } };
  }
  hasReusableDraft(): boolean {
    return !!this.createdDraft() && this.createdDraftRequest === JSON.stringify({ uploadId: this.uploadId.trim(), body: this.draftRequestBody(undefined, this.draftTitle()) });
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
      if (this.isCurrentProject(generation) && !cancelled && !this.pipelineError()) this.error.set(errorMessage(error));
    } finally {
      if (this.isCurrentProject(generation)) this.busy.set(false);
    }
  }
  private isCurrentProject(generation: number): boolean {
    return !this.disposed && generation === this.projectGeneration;
  }
}
