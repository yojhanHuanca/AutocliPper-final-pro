import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, output, signal } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { officialSourcePreview, recognizeSourceLink, type SourceLinkResult } from '../models/source-link';

@Component({
  selector: 'ac-source-link-preview',
  imports: [IconComponent],
  templateUrl: './source-link-preview.component.html',
  styleUrl: './source-link-preview.component.css',
})
export class SourceLinkPreviewComponent {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroy = inject(DestroyRef);
  readonly useFile = output<void>();
  readonly value = signal('');
  readonly result = signal<SourceLinkResult | null>(null);
  readonly previewState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly previewError = signal('');
  private readonly requestedFrame = signal<SafeResourceUrl | null>(null);
  private frameTimer?: ReturnType<typeof setTimeout>;
  private readonly frameOrigins = ['https://www.youtube-nocookie.com', 'https://player.twitch.tv', 'https://clips.twitch.tv', 'https://player.kick.com'];
  readonly width = signal(0);
  readonly previewFits = computed(() => this.width() >= (this.result()?.platform === 'Twitch' ? 402 : 202));
  readonly activeFrame = computed(() => this.previewFits() ? this.requestedFrame() : null);
  constructor() {
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
      });
    });
  }
  update(event: Event): void { this.value.set((event.target as HTMLInputElement).value); this.result.set(null); this.closePreview(); }
  validate(): void { this.closePreview(); this.result.set(recognizeSourceLink(this.value())); }
  loadPreview(): void {
    const target = this.result()?.target;
    if (!target || !this.previewFits()) return;
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
