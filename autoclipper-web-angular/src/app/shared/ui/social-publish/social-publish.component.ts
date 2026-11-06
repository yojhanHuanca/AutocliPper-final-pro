import { ConfirmationService } from '../confirmation/confirmation.service';
import { Component, DestroyRef, OnInit, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiTransport } from '../../../core/http/api-transport.service';
import { DESIGN_MODE } from '../../../core/config/design-mode.token';

type Provider = 'youtube' | 'tiktok';
type Connection = { provider: Provider; configured: boolean; linked: boolean; mode: 'inbox' | 'publish' };
type Publication = { id: string; provider: Provider; state: string; remoteUrl: string | null; errorCode: string | null; needsTikTokConfirmation: boolean };

@Component({
  selector: 'ac-social-publish',
  imports: [FormsModule],
  templateUrl: './social-publish.component.html',
  styles: [`:host{display:block;margin-block:1rem}.social-panel{border:1px solid var(--border,#ccc);border-radius:12px;padding:1rem}.social-connections{display:flex;gap:1rem;flex-wrap:wrap}.social-account{flex:1;min-width:180px}.social-fields{display:grid;gap:.8rem;margin-top:1rem}.social-fields label{display:grid;gap:.3rem}.social-fields input,.social-fields textarea,.social-fields select{width:100%;max-width:100%;padding:.6rem;border:1px solid var(--border,#bbb);border-radius:6px;background:var(--surface,#fff);color:inherit}.social-fields .social-consent{display:flex;align-items:flex-start;gap:.5rem}.social-consent input{width:auto;margin-top:.25rem}.social-status{padding:.75rem;background:var(--surface-subtle,rgba(128,128,128,.08));border-radius:8px}.social-error{color:var(--danger,#b32929)}summary{cursor:pointer;font-weight:600}.social-panel button{margin-top:.5rem}`],
})
export class SocialPublishComponent implements OnInit {
  private readonly api = inject(ApiTransport);
  private readonly confirmation = inject(ConfirmationService);
  private readonly destroy = inject(DestroyRef);
  readonly design = inject(DESIGN_MODE);
  readonly processingId = input('');
  readonly clipTitle = input('Mi clip');
  readonly connections = signal<Connection[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly publication = signal<Publication | null>(null);
  readonly loaded = signal(false);
  provider: Provider = 'youtube';
  title = '';
  description = '';
  privacy: 'private' | 'unlisted' | 'public' = 'private';
  madeForKids = '';
  consent = false;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private submissionKey = '';
  private submissionBody = '';
  constructor() {
    effect(() => {
      this.processingId(); this.generation++; this.busy.set(false);
      clearTimeout(this.timer); this.publication.set(null); this.error.set('');
      this.submissionKey = ''; this.submissionBody = ''; this.consent = false;
    });
    this.destroy.onDestroy(() => clearTimeout(this.timer));
  }
  ngOnInit() { if (!this.design) void this.refreshConnections(); }
  async refreshConnections() {
    this.error.set('');
    try { const result = await this.api.get<{ providers: Connection[] }>('/social/connections'); if (!this.destroy.destroyed) { this.connections.set(result.providers); this.loaded.set(true); } }
    catch (error) { if (!this.destroy.destroyed) this.error.set(this.message(error)); }
  }
  selectedConnection() { return this.connections().find(item => item.provider === this.provider); }
  async connect(provider: Provider) {
    if (this.design || this.busy()) return;
    this.busy.set(true); this.error.set('');
    try {
      const result = await this.api.post<{ authorizationUrl: string }>(`/social/${provider}/connect`, {});
      const url = new URL(result.authorizationUrl);
      const host = provider === 'youtube' ? 'accounts.google.com' : 'www.tiktok.com';
      if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password) throw new Error('Dirección de autorización no válida.');
      window.location.assign(url.toString());
    } catch (error) { this.error.set(this.message(error)); this.busy.set(false); }
  }
  async disconnect(provider: Provider) {
    if (this.design || this.busy()) return;
    if (!await this.confirmation.ask({ title: 'Desconectar la cuenta', message: `Se quitará la conexión con ${provider === 'youtube' ? 'YouTube' : 'TikTok'} de AutoClipper. Los videos que ya enviaste permanecerán en la plataforma.`, confirmLabel: 'Desconectar', danger: true })) return;
    if (this.destroy.destroyed || this.busy()) return;
    this.busy.set(true); this.error.set('');
    try { await this.api.delete(`/social/${provider}/connection`); await this.refreshConnections(); }
    catch (error) { this.error.set(this.message(error)); }
    finally { this.busy.set(false); }
  }
  async publish() {
    if (this.design || this.busy() || !this.processingId() || !this.selectedConnection()?.linked || !this.consent || !this.madeForKids) return;
    const title = (this.title || this.clipTitle()).trim();
    if (!title) { this.error.set('Escribe un título para el clip.'); return; }
    const input = { provider: this.provider, title, description: this.description, privacy: this.privacy, madeForKids: this.madeForKids === 'yes', consent: true };
    const serialized = JSON.stringify(input);
    if (serialized !== this.submissionBody) { this.submissionBody = serialized; this.submissionKey = crypto.randomUUID(); }
    this.busy.set(true); this.error.set('');
    const generation = this.generation;
    try {
      const result = await this.api.post<Publication>(`/processing/${encodeURIComponent(this.processingId())}/publications`, input, this.submissionKey);
      if (generation !== this.generation || this.destroy.destroyed) return;
      this.publication.set(result); this.schedulePoll(generation);
    } catch (error) { if (generation === this.generation) this.error.set(this.message(error)); }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
  private schedulePoll(generation: number) {
    clearTimeout(this.timer);
    if (generation !== this.generation || !['queued', 'uploading', 'processing'].includes(this.publication()?.state ?? '')) return;
    this.timer = setTimeout(() => void this.poll(generation), 3000);
  }
  async poll(generation = this.generation) {
    const job = this.publication();
    if (!job) return;
    try {
      const result = await this.api.get<Publication>(`/social/publications/${encodeURIComponent(job.id)}`);
      if (generation !== this.generation || this.destroy.destroyed) return;
      this.publication.set(result); this.error.set(''); this.schedulePoll(generation);
    } catch (error) { if (generation === this.generation && !this.destroy.destroyed) this.error.set(this.message(error)); }
  }
  stateLabel(state: string) { return ({ queued: 'En cola para enviar', uploading: 'Enviando el MP4', processing: 'TikTok está procesando el video', published: 'Video recibido por la plataforma', inbox: 'Enviado a tu bandeja de TikTok. Abre TikTok para revisar y publicar.', failed: 'No se pudo completar el envío', unknown: 'La plataforma no confirmó el resultado. Revisa tu cuenta antes de volver a enviar para evitar duplicados.' } as Record<string, string>)[state] ?? state; }
  safeRemoteUrl(value: string | null) { return value && /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/u.test(value) ? value : null; }
  private message(error: unknown) {
    const code = error instanceof HttpErrorResponse ? String(error.error?.code ?? '') : '';
    return ({ SOCIAL_OAUTH_NOT_CONFIGURED: 'Falta configurar la aplicación OAuth de esta plataforma en el servidor.', SOCIAL_RECONNECT_REQUIRED: 'Vuelve a conectar tu cuenta para autorizar el envío.', SOCIAL_RATE_LIMITED: 'La plataforma limitó las solicitudes. Inténtalo más tarde.', SOCIAL_CLIP_NOT_READY: 'El clip todavía no tiene un MP4 exportado listo para compartir.' } as Record<string, string>)[code] ?? (code ? `No se pudo completar la operación (${code}).` : 'No se pudo conectar con el servidor. Puedes reintentar.');
  }
}
