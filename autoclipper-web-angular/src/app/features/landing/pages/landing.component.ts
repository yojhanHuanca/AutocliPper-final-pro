import { BrandComponent } from '../../../shared/ui/brand/brand.component';
import {
  Component,
  AfterViewInit,
  DestroyRef,
  inject,
  signal,
  computed,
  effect,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { createAccentCycle, LANDING_ACCENTS } from '../landing-accent';
import { PlatformCarouselComponent } from '../components/platform-carousel/platform-carousel.component';
import { HeroDepthComponent } from '../components/hero-depth/hero-depth.component';

@Component({
  selector: "ac-landing",
  imports: [BrandComponent, RouterLink, IconComponent, PlatformCarouselComponent, HeroDepthComponent],
  host: {
    "[class.motion-paused]": "reducedMotion()",
    "[style.--accent]": "accent().color",
    "[style.--accent-hover]": "accent().hover",
    "[style.--tint]": "accent().tint",
  },
  templateUrl: "./landing.component.html",
  styleUrl: "./landing.component.css",
})
export class LandingComponent implements AfterViewInit {
  private readonly destroy = inject(DestroyRef);
  readonly scene = signal(0);
  readonly activeSection = signal('inicio');
  readonly sectionLinks = [
    { id: 'inicio', label: 'Inicio' },
    { id: 'plataformas', label: 'Plataformas' },
    { id: 'proceso', label: 'Cómo funciona' },
    { id: 'estudio', label: 'El estudio' },
    { id: 'alcance', label: 'Disponible hoy' },
  ];
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
    effect(() => cycle.configure(false, this.reducedMotion()));
    this.destroy.onDestroy(() => {
      cycle.destroy();
      preference.removeEventListener('change', onPreference);
    });
  }
  ngAfterViewInit(): void {
    const updateActive = () => {
      let current = 'inicio';
      for (const section of this.sectionLinks) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= window.innerHeight * .38) current = section.id;
      }
      if (document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 60) current = 'alcance';
      this.activeSection.set(current);
    };
    window.addEventListener('scroll', updateActive, { passive: true });
    window.addEventListener('resize', updateActive);
    this.destroy.onDestroy(() => {
      window.removeEventListener('scroll', updateActive);
      window.removeEventListener('resize', updateActive);
    });
    updateActive();
  }
  readonly bars = Array.from(
    { length: 64 },
    (_, n) => 20 + (Math.sin(n * 1.7) + 1) * 30,
  );
  readonly sceneLabels = ["Carga", "Transcribe", "Edita", "Exporta"];
  readonly transcriptLines = [
    { time: "00:12–00:16", text: "No necesitas contarlo todo." },
    { time: "00:16–00:20", text: "Solo encontrar esa idea que conecta." },
    { time: "00:20–00:24", text: "Y darle el espacio que merece." },
  ];
  readonly chapters = [
    {
      title: "Trae tu historia.",
      copy: "Elige un archivo local. Comprobamos su formato y duración antes de procesarlo.",
      detail: "Carga privada · hasta 100 MiB",
    },
    {
      title: "Cada palabra, en su lugar.",
      copy: "Consulta la transcripción con tiempos para encontrar la idea que quieres conservar.",
      detail: "Audio a texto · transcripción local",
    },
    {
      title: "Haz el corte tuyo.",
      copy: "Tú decides el inicio, el final y el encuadre. Guarda el borrador para seguir trabajando.",
      detail: "Selección manual · control creativo",
    },
    {
      title: "Llévate tu clip.",
      copy: "Descarga el video procesado y los subtítulos. Tú eliges dónde y cuándo compartirlo.",
      detail: "MP4 · SRT · VTT",
    },
  ];
}
