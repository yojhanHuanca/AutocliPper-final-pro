import { AfterViewInit, Component, DestroyRef, ElementRef, ViewChild, effect, inject, input, signal } from '@angular/core';

interface Platform {
  name: string;
  key: string;
  role: string;
}

@Component({
  selector: 'ac-platform-carousel',
  templateUrl: './platform-carousel.component.html',
  styleUrl: './platform-carousel.component.css',
})
export class PlatformCarouselComponent implements AfterViewInit {
  readonly reducedMotion = input(false);
  readonly hovered = signal(false);
  readonly focused = signal(false);

  readonly platforms: Platform[] = [
    { name: 'Kick', key: 'kick', role: 'Canal en directo' },
    { name: 'YouTube', key: 'youtube', role: 'Importar video' },
    { name: 'Twitch', key: 'twitch', role: 'Clips autorizados' },
    { name: 'TikTok', key: 'tiktok', role: 'Bandeja con OAuth' },
    { name: 'Instagram Reels', key: 'instagram', role: 'Destino previsto' },
    { name: 'YouTube Shorts', key: 'shorts', role: 'Enviar con OAuth' },
  ];

  @ViewChild('carousel') private carousel?: ElementRef<HTMLElement>;
  private readonly destroy = inject(DestroyRef);
  private frame = 0;
  private lastFrame = 0;
  private position = 0;
  private viewReady = false;
  private readonly onVisibilityChange = () => this.updateAnimation();

  constructor() {
    effect(() => {
      this.reducedMotion();
      this.hovered();
      this.focused();
      this.updateAnimation();
    });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.destroy.onDestroy(() => {
      this.stopAnimation();
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.updateAnimation();
  }

  private readonly tick = (time: number): void => {
    this.frame = 0;
    const element = this.carousel?.nativeElement;
    if (!this.viewReady || document.hidden || this.isPaused()) return;
    if (element && this.lastFrame) {
      const elapsed = Math.min(time - this.lastFrame, 48);
      const cycleWidth = element.scrollWidth / 2;
      if (cycleWidth > 0) {
        // Preserve subpixel progress even when the browser rounds scrollLeft at high refresh rates.
        this.position = (this.position + elapsed * 0.065) % cycleWidth;
        element.scrollLeft = this.position;
      }
    }
    this.lastFrame = time;
    this.frame = window.requestAnimationFrame(this.tick);
  };

  private updateAnimation(): void {
    this.stopAnimation();
    if (this.viewReady && !document.hidden && !this.isPaused()) {
      this.position = this.carousel?.nativeElement.scrollLeft ?? 0;
      this.lastFrame = 0;
      this.frame = window.requestAnimationFrame(this.tick);
    }
  }

  private stopAnimation(): void {
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastFrame = 0;
  }

  isPaused(): boolean {
    return this.reducedMotion() || this.hovered() || this.focused();
  }

  move(direction: -1 | 1): void {
    const element = this.carousel?.nativeElement;
    if (!element) return;
    const cycleWidth = element.scrollWidth / 2;
    if (!cycleWidth) return;
    this.position = (element.scrollLeft + direction * 216 + cycleWidth) % cycleWidth;
    element.scrollLeft = this.position;
  }
}
