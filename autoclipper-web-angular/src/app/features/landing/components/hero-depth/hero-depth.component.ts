import { AfterViewInit, Component, DestroyRef, ElementRef, inject } from '@angular/core';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';

@Component({
  selector: 'ac-hero-depth',
  imports: [IconComponent],
  templateUrl: './hero-depth.component.html',
  styleUrl: './hero-depth.component.css',
})
export class HeroDepthComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroy = inject(DestroyRef);
  private frame: number | undefined;
  private pointerX = 0;
  private pointerY = 0;
  private scrollDepth = 0;
  readonly wave = [34, 61, 45, 76, 52, 88, 38, 70, 47, 94, 63, 40, 83, 54, 72, 35, 65, 49];
  readonly selectedFrame = { title: 'Encuadre elegido por ti', position: '51%' };

  private readonly updateDepth = () => {
    if (this.frame !== undefined) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = undefined;
      const element = this.host.nativeElement.querySelector('.depth-stage') as HTMLElement | null;
      if (!element || this.motionIsPaused()) return;
      const bounds = element.getBoundingClientRect();
      const progress = (window.innerHeight * .82 - bounds.top) / (window.innerHeight + bounds.height);
      this.scrollDepth = Math.max(-1, Math.min(1, (progress - .5) * 2)) * 30;
      this.applyMotion(element);
    });
  };

  ngAfterViewInit(): void {
    window.addEventListener('scroll', this.updateDepth, { passive: true });
    window.addEventListener('resize', this.updateDepth, { passive: true });
    this.destroy.onDestroy(() => {
      window.removeEventListener('scroll', this.updateDepth);
      window.removeEventListener('resize', this.updateDepth);
      if (this.frame !== undefined) window.cancelAnimationFrame(this.frame);
    });
    this.updateDepth();
  }

  onPointerMove(event: PointerEvent): void {
    if (event.pointerType === 'touch' || this.motionIsPaused()) return;
    const stage = event.currentTarget as HTMLElement;
    const bounds = stage.getBoundingClientRect();
    this.pointerX = ((event.clientX - bounds.left) / bounds.width - .5) * 2 * 18;
    this.pointerY = ((event.clientY - bounds.top) / bounds.height - .5) * 2 * 12;
    this.applyMotion(stage);
  }

  resetPointer(): void {
    const stage = this.host.nativeElement.querySelector('.depth-stage') as HTMLElement | null;
    this.pointerX = 0;
    this.pointerY = 0;
    if (stage) this.applyMotion(stage);
  }

  private applyMotion(stage: HTMLElement): void {
    const layers: Record<string, [number, number, number, number]> = {
      '.source-card': [-.23, 0, .45, .1],
      '.clip-card': [.5, .2, -.55, .2],
      '.caption-float': [-.31, -.2, .8, -.2],
      '.selection-float': [.26, 0, -.7, 0],
      '.cut-icon': [.18, 0, -.18, 0],
    };
    for (const [selector, [pointerX, pointerY, scrollY, pointerScrollY]] of Object.entries(layers)) {
      const element = stage.querySelector<HTMLElement>(selector);
      if (!element) continue;
      element.style.setProperty('--layer-x', `${(this.pointerX * pointerX).toFixed(1)}px`);
      element.style.setProperty('--layer-y', `${(this.scrollDepth * scrollY + this.pointerY * pointerScrollY).toFixed(1)}px`);
    }
  }

  private motionIsPaused(): boolean {
    return this.host.nativeElement.closest('.motion-paused') !== null || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
