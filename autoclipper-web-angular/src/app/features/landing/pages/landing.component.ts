import { BrandComponent } from '../../../shared/ui/brand/brand.component';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  inject,
  signal,
  computed,
  effect,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { createAccentCycle, LANDING_ACCENTS } from '../landing-accent';

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-landing",
  imports: [BrandComponent, RouterLink, IconComponent],
  host: {
    "[class.motion-paused]": "motionPaused() || reducedMotion()",
    "[style.--accent]": "accent().color",
    "[style.--accent-hover]": "accent().hover",
    "[style.--tint]": "accent().tint",
  },
  templateUrl: "./landing.component.html",
  styleUrl: "./landing.component.css",
})
export class LandingComponent implements AfterViewInit {
  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly destroy = inject(DestroyRef);
  readonly scene = signal(0);
  readonly motionPaused = signal(false);
  readonly reducedMotion = signal(false);
  private readonly accentIndex = signal(0);
  readonly accent = computed(() => LANDING_ACCENTS[this.accentIndex()]);
  constructor() {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion.set(preference.matches);
    const onPreference = () => this.reducedMotion.set(preference.matches);
    preference.addEventListener('change', onPreference);
    const cycle = createAccentCycle(index => this.accentIndex.set(index), (tick, ms) => {
      const timer = window.setInterval(tick, ms);
      return () => window.clearInterval(timer);
    });
    effect(() => cycle.configure(this.motionPaused(), this.reducedMotion()));
    this.destroy.onDestroy(() => {
      cycle.destroy();
      preference.removeEventListener('change', onPreference);
    });
  }
  readonly bars = Array.from(
    { length: 64 },
    (_, n) => 20 + (Math.sin(n * 1.7) + 1) * 30,
  );
  readonly sceneLabels = ["Carga", "Transcribe", "Edita", "Exporta"];
  readonly sceneTitles = [
    "Todo empieza con tu video.",
    "Dale voz a cada palabra.",
    "Encuentra tu propio corte.",
    "Listo para otra historia.",
  ];
  readonly chapters = [
    {
      title: "Trae tu historia.",
      copy: "Carga tu archivo en un espacio privado. Comprobamos su integridad y formato antes de procesarlo.",
      detail: "MP4 · WebM · MOV · MKV / hasta 100 MiB",
    },
    {
      title: "Cada palabra, en su lugar.",
      copy: "La transcripción local convierte el audio en texto con tiempos. Tú eliges el intervalo del clip.",
      detail: "whisper.cpp local / selección manual",
    },
    {
      title: "Haz el corte tuyo.",
      copy: "Ajusta formato, encuadre y subtítulos. Guarda cada decisión como una revisión que puedes recuperar.",
      detail: "9:16 · 1:1 · 16:9 / revisiones versionadas",
    },
    {
      title: "Comparte el resultado.",
      copy: "Revisa con tu equipo y descarga el render autorizado, junto con sus archivos de subtítulos.",
      detail: "MP4 · SRT · VTT / enlaces privados temporales",
    },
  ];
  ngAfterViewInit(): void {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting)
            this.scene.set(
              Number((entry.target as HTMLElement).dataset["chapter"]),
            );
      },
      { rootMargin: "-25% 0px -35% 0px", threshold: 0 },
    );
    this.element.nativeElement
      .querySelectorAll(".chapter")
      .forEach((node: Element) => observer.observe(node));
    this.destroy.onDestroy(() => observer.disconnect());
  }
}
