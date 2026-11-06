import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, input, output, signal, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { errorMessage } from '../../../core/http/api-error';
import { ProjectsApi } from '../data-access/projects-api.service';
import type { Schema } from '../../../core/contracts/api-types';
import { canonicalTwitchClipImportUrl, canonicalYouTubeMetadataUrl, officialSourcePreview, recognizeSourceLink, unsupportedSourceImportResolution, type SourceImportResolution, type SourceLinkResult, type YoutubeVideoMetadata } from '../models/source-link';

@Component({
  selector: 'ac-source-link-preview',
  imports: [IconComponent],
  templateUrl: './source-link-preview.component.html',
  styleUrl: './source-link-preview.component.css',
})
export class SourceLinkPreviewComponent implements OnInit {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly api = inject(ProjectsApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroy = inject(DestroyRef);
  readonly active = input(true);
  readonly projectId = input('');
  readonly canImport = input(false);
  readonly initialUrl = input('');
  readonly previewOnly = input(false);
  readonly imported = output<{ uploadId: string; title?: string; provider?: 'youtube' | 'twitch' }>();
  readonly previewAvailable = output<boolean>();
  readonly linkChanged = output<string>();
  readonly value = signal('');
  readonly result = signal<SourceLinkResult | null>(null);
  readonly previewState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly previewError = signal('');
  readonly twitchStatus = signal<{ configured: boolean; linked: boolean; account: { id?: string; login?: string } | null } | null>(null);
  readonly sourceCapabilities = signal<Schema<'SourceLinkCapabilitiesDto'> | null>(null);
  readonly sourceBusy = signal(false);
  readonly importing = signal(false);
  readonly sourceNotice = signal('');
  readonly sourceError = signal('');
  readonly resolved = signal<{ title?: string; durationSeconds?: number } | null>(null);
  readonly importResolution = signal<SourceImportResolution | null>(null);
  private importKey = '';
  private lastProjectId: string | null = null;
  private sourceOperationGeneration = 0;
  private youtubeMetadataAbortController: AbortController | null = null;
  private twitchStatusGeneration = 0;
  private lastCanImport: boolean | null = null;
  private readonly requestedFrame = signal<SafeResourceUrl | null>(null);
  private frameTimer?: ReturnType<typeof setTimeout>;
  private readonly frameOrigins = ['https://www.youtube-nocookie.com', 'https://player.twitch.tv', 'https://clips.twitch.tv', 'https://player.kick.com'];
  readonly width = signal(0);
  readonly previewFits = computed(() => this.width() >= (this.result()?.platform === 'Twitch' ? 402 : 202));
  readonly activeFrame = computed(() => this.active() && this.previewFits() ? this.requestedFrame() : null);
  constructor() {
    effect(() => {
      const initial = this.initialUrl().trim();
      if (!initial || this.value()) return;
      this.value.set(initial);
      this.validate();
    });
    effect(() => {
      this.synchronizeProjectSource(this.projectId(), this.initialUrl().trim());
    });
    effect(() => {
      const allowed = this.canImport();
      if (this.lastCanImport === true && !allowed) {
        this.invalidateSourceOperation();
        this.twitchStatusGeneration++;
        this.twitchStatus.set(null);
        this.resolved.set(null);
        this.importKey = '';
      }
      if (this.lastCanImport === false && allowed) void this.refreshTwitchStatus();
      this.lastCanImport = allowed;
    });
    effect(() => this.onVisibilityChange(this.active()));
    afterNextRender(() => {
      const observer = new ResizeObserver(entries => this.width.set(entries[0]?.contentRect.width ?? 0));
      observer.observe(this.host.nativeElement);
      const onPolicyViolation = (event: SecurityPolicyViolationEvent) => {
        if (!/^frame-src(?:-|$)/.test(event.effectiveDirective) || !this.requestedFrame() || this.previewState() !== 'loading') return;
        let blockedOrigin = event.blockedURI;
        try { blockedOrigin = new URL(event.blockedURI).origin; } catch { /* Keep a non-URL value unmatched. */ }
        if (!this.frameOrigins.includes(blockedOrigin)) return;
        this.failPreview('La política de seguridad de este sitio bloqueó el reproductor. El video sigue sin importarse; puedes usar un archivo local.');
      };
      document.addEventListener('securitypolicyviolation', onPolicyViolation);
      this.destroy.onDestroy(() => {
        observer.disconnect();
        document.removeEventListener('securitypolicyviolation', onPolicyViolation);
        clearTimeout(this.frameTimer);
        this.youtubeMetadataAbortController?.abort();
        this.youtubeMetadataAbortController = null;
      });
    });
  }
  ngOnInit(): void { if (this.canImport()) void this.refreshTwitchStatus(); }
  private synchronizeProjectSource(projectId: string, initialUrl: string): void {
    if (this.lastProjectId === null) {
      this.lastProjectId = projectId;
      return;
    }
    if (projectId === this.lastProjectId) return;
    this.lastProjectId = projectId;
    this.resetForProject(initialUrl);
  }
  private resetForProject(initialUrl: string): void {
    this.invalidateSourceOperation();
    this.value.set(initialUrl);
    this.result.set(null);
    this.previewAvailable.emit(false);
    this.resolved.set(null);
    this.importResolution?.set(null);
    this.sourceCapabilities?.set(null);
    this.sourceNotice.set('');
    this.sourceError.set('');
    this.importKey = '';
    this.closePreview();
    if (initialUrl) this.validate();
    if (this.canImport?.()) void this.refreshTwitchStatus();
  }
  update(event: Event): void { const value = (event.target as HTMLInputElement).value; this.invalidateSourceOperation(); this.value.set(value); this.linkChanged.emit(value); this.result.set(null); this.previewAvailable.emit(false); this.resolved.set(null); this.importResolution?.set(null); this.sourceNotice.set(''); this.sourceError.set(''); this.importKey = ''; this.closePreview(); }
  validate(): void {
    this.closePreview(); this.resolved.set(null); this.importResolution?.set(null); this.sourceError.set(''); this.sourceNotice.set('');
    const result = recognizeSourceLink(this.value());
    this.result.set(result);
    this.previewAvailable.emit(result.state === 'preview');
    if (result.target) this.importResolution?.set(unsupportedSourceImportResolution(result.target));
    this.applyTwitchCapabilityGuidance();
    if (result.target?.platform === 'Twitch' && result.target.kind === 'clip' && this.canImport?.()) void this.resolveTwitch();
    if (result.target?.platform === 'Twitch' && result.target.kind === 'video') {
      this.importResolution.set({
        provider: 'twitch', state: 'input_required', importable: false,
        reasonCode: 'TWITCH_VOD_INTERVAL_REQUIRED', nextAction: 'upload_authorized_file',
        message: 'VOD de Twitch reconocido. La API disponible solo permite importar un fragmento cuando se indica un intervalo manual; este flujo no solicita segundos y no iniciará ese recorte.',
        nextStep: 'Pega el enlace de un clip de Twitch ya publicado o sube el MP4 autorizado del VOD para generar clips automáticamente.',
      });
    }
    if (result.target?.platform === 'YouTube' && this.canImport?.() && this.projectId?.()) void this.resolveYouTubeMetadata();
  }
  async resolveYouTubeMetadata(): Promise<void> {
    const target = this.result()?.target;
    if (!this.canImport() || !target || target.platform !== 'YouTube' || target.kind !== 'video' || this.sourceBusy()) return;
    const projectId = this.projectId();
    const inputUrl = this.value().trim();
    const url = canonicalYouTubeMetadataUrl(this.result());
    if (!projectId || !url) return;
    const operationGeneration = this.sourceOperationGeneration;
    const controller = new AbortController();
    this.youtubeMetadataAbortController = controller;
    this.sourceBusy.set(true);
    this.sourceError.set('');
    this.sourceNotice.set('');
    try {
      const answer = await this.api.resolveSourceLink(projectId, url, { signal: controller.signal, timeoutMs: 7_000 });
      if (operationGeneration !== this.sourceOperationGeneration || !this.canImport() || this.projectId() !== projectId || this.value().trim() !== inputUrl) return;
      if (answer.provider !== 'youtube') throw new Error('El servidor devolvió metadatos para otro proveedor.');
      this.importResolution.set(answer);
      if (answer.state === 'available' && answer.importable) {
        this.resolved.set({ title: answer.youtubeMetadata?.title || 'Video de YouTube', durationSeconds: answer.youtubeMetadata?.durationSeconds });
        this.sourceNotice.set('Video reconocido. Al importar se descargará y verificará antes de generar los clips.');
      } else this.sourceNotice.set(answer.message || 'Este video no está disponible para importar.');
    } catch (error) {
      if (operationGeneration !== this.sourceOperationGeneration || !this.canImport() || this.projectId() !== projectId || this.value().trim() !== inputUrl) return;
      this.sourceError.set(error instanceof TimeoutError
        ? 'La consulta de YouTube tardó demasiado. El enlace sigue siendo solo una vista previa; puedes reintentar o usar un MP4 autorizado.'
        : this.sourceErrorMessage(error));
    } finally {
      if (operationGeneration === this.sourceOperationGeneration) {
        this.sourceBusy.set(false);
        this.youtubeMetadataAbortController = null;
      }
    }
  }
  hasAvailableYoutubeMetadata(metadata: YoutubeVideoMetadata | null | undefined): metadata is YoutubeVideoMetadata & { state: 'available'; title: string; channelTitle: string; durationSeconds: number } {
    return metadata?.state === 'available' && typeof metadata.title === 'string' && !!metadata.title.trim() &&
      typeof metadata.channelTitle === 'string' && !!metadata.channelTitle.trim() &&
      typeof metadata.durationSeconds === 'number' && Number.isFinite(metadata.durationSeconds) && metadata.durationSeconds >= 0;
  }
  safeYoutubeThumbnail(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'i.ytimg.com' && !url.username && !url.password ? url.toString() : null;
    } catch { return null; }
  }
  formatYoutubeDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainder = total % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
      : `${minutes}:${String(remainder).padStart(2, '0')}`;
  }
  youtubeMetadataUnavailableMessage(reasonCode?: string): string {
    const messages: Record<string, string> = {
      YOUTUBE_VIDEO_UNAVAILABLE: 'YouTube no permite acceder a este video. Revisa si es privado, está restringido o requiere iniciar sesión.',
      YOUTUBE_DOWNLOAD_TIMEOUT: 'La descarga tardó demasiado. Puedes volver a intentarlo.',
      YOUTUBE_DOWNLOAD_TOO_LARGE: 'El video supera los 100 MiB admitidos. Usa un archivo más pequeño.',
      YOUTUBE_DOWNLOAD_FAILED: 'No se pudo descargar este video. Revisa su disponibilidad o sube el archivo original.',
      YOUTUBE_DOWNLOADER_NOT_CONFIGURED: 'El servidor necesita actualizar su imagen para instalar el descargador.',
      YOUTUBE_IMPORT_BUSY: 'Ya hay otras descargas en curso. Espera unos segundos.',
      YOUTUBE_METADATA_NOT_CONFIGURED: 'Los datos de YouTube no están configurados en el servidor. Puedes continuar con un MP4 autorizado.',
      YOUTUBE_METADATA_NOT_FOUND: 'YouTube no encontró este video. Revisa el enlace o usa un MP4 autorizado.',
      YOUTUBE_METADATA_RATE_LIMITED: 'YouTube limitó temporalmente la consulta. Vuelve a intentarlo más tarde.',
      YOUTUBE_METADATA_UNAVAILABLE: 'No pudimos consultar los datos de YouTube ahora. Puedes volver a intentarlo.',
    };
    return messages[reasonCode ?? ''] ?? 'No se recibieron los metadatos del video. El enlace sigue siendo solo una vista previa; para procesar, usa un MP4 inspeccionado.';
  }
  async refreshTwitchStatus(): Promise<void> {
    if (!this.canImport() || !this.projectId()) return;
    const generation = ++this.twitchStatusGeneration;
    const projectId = this.projectId();
    this.sourceError.set('');
    try {
      const capabilityRequest = this.api.sourceLinkCapabilities?.(projectId).catch(() => null) ?? Promise.resolve(null);
      const [status, capabilities] = await Promise.all([this.api.twitchLinkStatus(), capabilityRequest]);
      if (generation !== this.twitchStatusGeneration || !this.canImport() || this.projectId() !== projectId) return;
      this.twitchStatus.set(status);
      this.sourceCapabilities?.set(capabilities);
      if (this.result()?.target?.platform === 'Twitch' && (!status.configured || !status.linked)) { this.resolved.set(null); this.importKey = ''; }
      if (this.result()?.target?.platform === 'Twitch') this.sourceNotice.set('');
      this.applyTwitchCapabilityGuidance();
    } catch (error) {
      if (generation !== this.twitchStatusGeneration || !this.canImport()) return;
      this.twitchStatus.set(null);
      this.sourceCapabilities?.set(null);
      if (this.result()?.target?.platform === 'Twitch') { this.resolved.set(null); this.importKey = ''; this.sourceError.set(this.sourceErrorMessage(error)); }
    }
  }
  private applyTwitchCapabilityGuidance(): void {
    const target = this.result?.()?.target;
    const status = this.twitchStatus?.();
    if (!this.canImport?.() || target?.platform !== 'Twitch' || !status) return;
    const capability = this.sourceCapabilities?.()?.providers.find(provider => provider.provider === 'twitch');
    if (!status.configured) this.importResolution?.set({provider:'twitch',state:'unavailable',importable:false,reasonCode:'TWITCH_OAUTH_NOT_CONFIGURED',nextAction:'configure_twitch_oauth',message:'La importación de Twitch no está configurada en este servidor.',nextStep:'Pide al responsable del entorno que configure la app OAuth de Twitch en Identity.'});
    else if (!status.linked) this.importResolution?.set({provider:'twitch',state:'unavailable',importable:false,reasonCode:'TWITCH_ACCOUNT_NOT_LINKED',nextAction:'link_twitch_account',message:'No hay una cuenta de Twitch vinculada.',nextStep:'Vincula tu cuenta desde Configuración y vuelve a validar el enlace.'});
    else if (capability?.configurationState === 'clip_scope_missing') this.importResolution?.set({provider:'twitch',state:'unavailable',importable:false,reasonCode:'TWITCH_CLIP_SCOPE_REQUIRED',nextAction:'link_twitch_account',message:'La cuenta de Twitch vinculada no tiene el permiso requerido para administrar clips.',nextStep:'Vuelve a conectar Twitch y acepta el permiso de administración de clips.'});
    else if (!this.resolved()) this.importResolution?.set(null);
  }
  async connectTwitch(): Promise<void> {
    if (!this.canImport() || !this.twitchStatus()?.configured || this.sourceBusy()) return;
    this.sourceBusy.set(true); this.sourceError.set('');
    try {
      const { authorizationUrl } = await this.api.linkTwitch();
      const target = new URL(authorizationUrl);
      if (target.protocol !== 'https:' || target.hostname !== 'id.twitch.tv') throw new Error('El servidor devolvió un destino de autorización no válido.');
      window.location.assign(target.toString());
    } catch (error) { this.sourceError.set(this.sourceErrorMessage(error)); this.sourceBusy.set(false); }
  }
  async disconnectTwitch(): Promise<void> {
    if (!this.canImport() || this.sourceBusy()) return;
    this.twitchStatusGeneration++;
    this.sourceBusy.set(true); this.sourceError.set('');
    try { await this.api.unlinkTwitch(); this.resolved.set(null); this.sourceNotice.set('Cuenta Twitch desvinculada.'); await this.refreshTwitchStatus(); }
    catch (error) { this.sourceError.set(this.sourceErrorMessage(error)); }
    finally { this.sourceBusy.set(false); }
  }
  async resolveTwitch(): Promise<void> {
    const target = this.result()?.target;
    if (!this.canImport() || !target || target.platform !== 'Twitch' || !this.twitchStatus()?.configured || !this.twitchStatus()?.linked || this.sourceBusy()) return;
    if (target.kind !== 'clip') return;
    const projectId = this.projectId(), inputUrl = this.value().trim(), url = canonicalTwitchClipImportUrl(this.result());
    if (!url) return;
    const operationGeneration = this.sourceOperationGeneration;
    this.sourceBusy.set(true); this.sourceError.set(''); this.sourceNotice.set(''); this.resolved.set(null);
    try {
      const answer = await this.api.resolveSourceLink(projectId, url);
      if (operationGeneration !== this.sourceOperationGeneration || !this.canImport() || this.projectId() !== projectId || this.value().trim() !== inputUrl) return;
      this.importResolution?.set(answer);
      if (answer.provider === 'twitch' && answer.state === 'available' && answer.importable === true) {
        this.resolved.set({ title: answer.title, durationSeconds: answer.durationSeconds });
        this.sourceNotice.set('Clip confirmado por Twitch. Al importarlo, el servidor lo guardará e inspeccionará; después podrás elegir cantidad y duración para la generación automática.');
        this.importKey = '';
      } else if (answer.state === 'unavailable' || answer.state === 'unsupported') {
        this.sourceError.set('');
      } else {
        const serverGuidance = [answer.message, answer.nextStep].map(value => value?.trim()).filter(Boolean).join(' ');
        this.sourceError.set(serverGuidance || this.reasonMessage(answer.reasonCode ?? 'TWITCH_CLIP_UNAVAILABLE'));
      }
    } catch (error) {
      if (operationGeneration !== this.sourceOperationGeneration || !this.canImport() || this.projectId() !== projectId || this.value().trim() !== inputUrl) return;
      this.importResolution?.set(null);
      this.sourceNotice.set('');
      this.clearTwitchAuthorizationIfLost(error);
      this.sourceError.set(this.sourceErrorMessage(error));
    }
    finally { if (operationGeneration === this.sourceOperationGeneration) this.sourceBusy.set(false); }
  }
  async importTwitch(): Promise<void> {
    const available = this.resolved();
    const isYoutube = this.result()?.target?.platform === 'YouTube';
    if (!this.canImport() || (!isYoutube && (!this.twitchStatus()?.configured || !this.twitchStatus()?.linked)) || !available || this.sourceBusy()) return;
    const projectId = this.projectId(), inputUrl = this.value().trim();
    const url = isYoutube ? canonicalYouTubeMetadataUrl(this.result()) : canonicalTwitchClipImportUrl(this.result());
    if (!url) return;
    const operationGeneration = this.sourceOperationGeneration;
    this.importing.set(true); this.sourceBusy.set(true); this.sourceError.set(''); this.sourceNotice.set('Descargando el video e iniciando su inspección…');
    this.importKey ||= crypto.randomUUID();
    try {
      const answer = await this.api.importSourceLink(projectId, url, this.importKey);
      if (operationGeneration !== this.sourceOperationGeneration || !this.canImport() || this.projectId() !== projectId || this.value().trim() !== inputUrl) return;
      if (answer.state === 'succeeded' && answer.uploadId) {
        this.sourceNotice.set('Clip importado. Preparando la inspección…');
        this.resolved.set(null);
        this.imported.emit({ uploadId: answer.uploadId, title: available.title || answer.title, provider: isYoutube ? 'youtube' : 'twitch' });
      } else if (answer.state === 'importing') {
        this.sourceNotice.set('La importación sigue en curso. Vuelve a intentarlo en unos segundos para consultar el mismo proceso.');
      } else {
        this.sourceError.set('El servidor no confirmó una carga para este clip. No se agregó al proyecto.');
      }
    } catch (error) {
      if (operationGeneration !== this.sourceOperationGeneration || !this.canImport() || this.projectId() !== projectId || this.value().trim() !== inputUrl) return;
      this.sourceNotice.set('');
      this.clearTwitchAuthorizationIfLost(error);
      this.sourceError.set(this.sourceErrorMessage(error));
    }
    finally { if (operationGeneration === this.sourceOperationGeneration) { this.sourceBusy.set(false); this.importing.set(false); } }
  }
  private invalidateSourceOperation(): void {
    this.importing.set(false);
    this.sourceOperationGeneration++;
    this.youtubeMetadataAbortController?.abort();
    this.youtubeMetadataAbortController = null;
    this.sourceBusy.set(false);
  }
  cancelYouTubeMetadata(): void {
    if (!this.youtubeMetadataAbortController) return;
    this.invalidateSourceOperation();
    this.sourceError.set('Consulta cancelada. Puedes volver a intentarlo o continuar con un MP4 autorizado.');
  }
  private clearTwitchAuthorizationIfLost(error: unknown): void {
    const code = error instanceof HttpErrorResponse ? String(error.error?.code ?? '') : '';
    if (!['TWITCH_OAUTH_NOT_CONFIGURED', 'TWITCH_ACCOUNT_NOT_LINKED', 'TWITCH_ACCOUNT_BINDING_INVALID'].includes(code)) return;
    this.twitchStatusGeneration++;
    this.twitchStatus.set(null);
    this.resolved.set(null);
    this.importKey = '';
  }
  private sourceErrorMessage(error: unknown): string {
    const code = error instanceof HttpErrorResponse ? String(error.error?.code ?? '') : '';
    if (code) return this.reasonMessage(code);
    return errorMessage(error);
  }
  private reasonMessage(code: string): string {
    const known: Record<string, string> = {
      RESOURCE_NOT_FOUND: 'Este Gateway todavía no publica la ruta de conexión Twitch. No se inició OAuth ni ninguna importación; puedes usar la carga local.',
      TWITCH_OAUTH_NOT_CONFIGURED: 'La conexión con Twitch aún no está configurada en el servidor. Mientras tanto, puedes cargar un MP4 propio.',
      TWITCH_ACCOUNT_NOT_LINKED: 'Vincula una cuenta Twitch para revisar e importar clips.',
      TWITCH_CHANNEL_EDITOR_REQUIRED: 'La cuenta vinculada debe ser editor del canal que publicó este clip.',
      TWITCH_CLIP_SCOPE_REQUIRED: 'Twitch no concedió el permiso necesario para administrar clips.',
      TWITCH_VOD_INTERVAL_REQUIRED: 'Este flujo solo ofrece vista previa para VOD de Twitch. Pega el enlace de un clip publicado o sube el MP4 autorizado.',
      TWITCH_VOD_OFFSET_OUT_OF_RANGE: 'El intervalo termina fuera de la duración disponible del VOD. Revisa el segundo final.',
      TWITCH_VOD_NOT_FOUND: 'Twitch no encontró este VOD o no está disponible para esta cuenta.',
      TWITCH_VOD_CLIP_OUTCOME_UNKNOWN: 'Twitch no confirmó si creó el clip. Comprueba el canal antes de intentar otra vez.',
      TWITCH_CONSENT_DENIED: 'Se canceló la autorización de Twitch. Puedes volver a intentarlo.',
      TWITCH_RATE_LIMITED: 'Twitch limitó temporalmente las solicitudes. Espera y vuelve a intentarlo.',
      TWITCH_CLIP_UNAVAILABLE: 'Twitch no confirmó que este clip esté disponible para importar.',
      TWITCH_CLIP_NOT_FOUND: 'Twitch no encontró el clip indicado.',
      TWITCH_IMPORT_UNAVAILABLE: 'La importación de clips no está disponible ahora mismo en el servidor.',
      TWITCH_CLIP_DURATION_UNSUPPORTED: 'Este clip está fuera del límite local de análisis, que admite hasta cinco minutos.',
      TWITCH_DOWNLOAD_TOO_LARGE: 'El archivo supera el tamaño máximo admitido para una importación.',
      TWITCH_ACCOUNT_ALREADY_LINKED: 'Esta cuenta Twitch ya está vinculada a otro usuario de AutoClipper.',
      TWITCH_ACCOUNT_BINDING_INVALID: 'No se pudo validar la cuenta Twitch vinculada. Vuelve a conectarla.',
      TWITCH_IMPORT_BUSY: 'Ya hay una importación de Twitch en curso. Espera y vuelve a intentarlo.',
      TWITCH_IMPORT_FAILED: 'No se pudo importar el clip. El servidor no confirmó una carga.',
      YOUTUBE_METADATA_NOT_CONFIGURED: 'Los datos de YouTube no están configurados en el servidor. El enlace sigue siendo solo una vista previa.',
      YOUTUBE_METADATA_NOT_FOUND: 'YouTube no encontró este video. Revisa el enlace.',
      YOUTUBE_METADATA_RATE_LIMITED: 'YouTube limitó temporalmente la consulta de datos. Vuelve a intentarlo más tarde.',
      YOUTUBE_METADATA_UNAVAILABLE: 'No pudimos consultar los datos de YouTube ahora. Vuelve a intentarlo.',
      YOUTUBE_VIDEO_UNAVAILABLE: 'YouTube no permite descargar este video. Comprueba que sea público o carga el MP4 original.',
      LOCAL_TRANSCRIPTION_DURATION_LIMIT: 'Este video supera las dos horas admitidas por la transcripción local. Usa un video más corto.',
    };
    if (code === 'YOUTUBE_DOWNLOAD_TIMEOUT') return 'La descarga de YouTube superó el tiempo permitido. Puedes reintentar o cargar un MP4.';
    if (code === 'YOUTUBE_DOWNLOAD_TOO_LARGE') return 'El video de YouTube supera el tamaño permitido. Puedes cargar una versión más pequeña.';
    return known[code] ?? `No se pudo completar la operación (${code}).`;
  }
  loadPreview(): void {
    const target = this.result()?.target;
    if (!target || !this.active() || !this.previewFits()) return;
    const url = officialSourcePreview(target, window.location.hostname);
    // Only the closed official-origin builder reaches Angular's resource URL trust boundary.
    if (!url) return;
    clearTimeout(this.frameTimer);
    this.previewError.set('');
    this.previewState.set('loading');
    this.requestedFrame.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
    this.frameTimer = setTimeout(() => {
      if (this.previewState() === 'loading') this.failPreview('La plataforma tardó demasiado en responder. Revisa la conexión o vuelve a intentarlo.');
    }, 15000);
    this.focusPreview('iframe');
  }
  previewLoaded(): void {
    if (!this.requestedFrame() || this.previewState() !== 'loading') return;
    clearTimeout(this.frameTimer);
    this.previewState.set('ready');
  }
  previewFailed(): void { this.failPreview('No se pudo abrir el reproductor. Comprueba la conexión o vuelve a intentarlo.'); }
  onVisibilityChange(active: boolean): void {
    if (!active) { this.closePreview(); return; }
  }
  private failPreview(message: string): void {
    clearTimeout(this.frameTimer);
    this.requestedFrame.set(null);
    this.previewState.set('error');
    this.previewError.set(message);
    this.focusPreview('.link-player-error button');
  }
  closePreview(restoreFocus = false): void {
    clearTimeout(this.frameTimer);
    this.requestedFrame.set(null);
    this.previewState.set('idle');
    this.previewError.set('');
    if (restoreFocus) this.focusPreview('.link-preview-placeholder button');
  }
  private focusPreview(selector: string): void {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
      if (!this.destroy.destroyed) this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
    });
  }
}
