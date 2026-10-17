import { AfterViewInit, Component, DestroyRef, ElementRef, ViewChild, inject, input, signal } from '@angular/core';

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
  readonly pausedByPage = input(false);
  readonly reducedMotion = input(false);
  readonly pausedByUser = signal(false);
  readonly hovered = signal(false);
  readonly focused = signal(false);

  readonly platforms: Platform[] = [
    { name: 'YouTube', key: 'youtube', role: 'Origen previsto' },
    { name: 'Twitch', key: 'twitch', role: 'Origen previsto' },
    { name: 'Kick', key: 'kick', role: 'Origen previsto' },
    { name: 'TikTok', key: 'tiktok', role: 'Destino previsto' },
    { name: 'Instagram Reels', key: 'instagram', role: 'Destino previsto' },
    { name: 'YouTube Shorts', key: 'shorts', role: 'Destino previsto' },
  ];

  @ViewChild('carousel') private carousel?: ElementRef<HTMLElement>;
  private readonly destroy = inject(DestroyRef);
  private frame = 0;
  private lastFrame = 0;

  constructor() {
    this.destroy.onDestroy(() => window.cancelAnimationFrame(this.frame));
  }

  ngAfterViewInit(): void {
    this.frame = window.requestAnimationFrame(this.tick);
  }

  private readonly tick = (time: number): void => {
    const element = this.carousel?.nativeElement;
    if (element && this.lastFrame && !document.hidden && !this.isPaused()) {
      const elapsed = Math.min(time - this.lastFrame, 48);
      const cycleWidth = element.scrollWidth / 2;
      if (cycleWidth > 0) {
        element.scrollLeft = (element.scrollLeft + elapsed * 0.037) % cycleWidth;
      }
    }
    this.lastFrame = time;
    this.frame = window.requestAnimationFrame(this.tick);
  };

  isPaused(): boolean {
    return this.pausedByPage() || this.reducedMotion() || this.pausedByUser() || this.hovered() || this.focused();
  }

  move(direction: -1 | 1): void {
    const element = this.carousel?.nativeElement;
    if (!element) return;
    const cycleWidth = element.scrollWidth / 2;
    if (!cycleWidth) return;
    element.scrollLeft = (element.scrollLeft + direction * 216 + cycleWidth) % cycleWidth;
  }
}
