import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  inject,
} from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { interceptRouteLinks, transitionForHref } from "../../../shared/ui/route-transition";
import { BrandComponent } from "../../../shared/ui/brand/brand.component";
import { CLIP_VIDEOS, HERO_VIDEO, TRANSFORM_VIDEO, type LandingVideo } from "../landing-media";
import { startLandingMotion } from "../landing-motion";

const INTRO_SEEN_KEY = "ac-landing-intro-seen";

@Component({
  selector: "ac-landing",
  imports: [RouterLink, BrandComponent],
  templateUrl: "./landing.component.html",
  styleUrl: "./landing.component.css",
  encapsulation: ViewEncapsulation.None,
})
export class LandingComponent implements AfterViewInit {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroy = inject(DestroyRef);
  private readonly router = inject(Router);

  ngAfterViewInit(): void {
    const root = this.host.nativeElement.querySelector<HTMLElement>(".acl");
    if (!root) return;
    const media: Record<string, LandingVideo> = { hero: HERO_VIDEO, transform: TRANSFORM_VIDEO };
    CLIP_VIDEOS.forEach((clip, index) => (media[`clip-${index}`] = clip));

    const stop = startLandingMotion(root, {
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      finePointer: window.matchMedia("(pointer: fine)").matches,
      skipIntro: readIntroSeen(),
      media,
      onIntroDone: () => writeIntroSeen(),
    });
    this.destroy.onDestroy(stop);

    // Salidas hacia acceso/registro con transición de pantalla completa.
    // Los botones de los planes crecen desde su propia tarjeta.
    const stopLinks = interceptRouteLinks(root, (url) => this.router.navigateByUrl(url), (anchor) => {
      const plan = anchor.closest<HTMLElement>(".acl-plan");
      if (plan) {
        const name = plan.querySelector("h3")?.textContent?.trim() ?? "";
        return { mode: "card", label: `Plan ${name}`, kicker: "Elegiste", from: plan.getBoundingClientRect() };
      }
      return transitionForHref(anchor.getAttribute("href") ?? "/", anchor);
    });
    this.destroy.onDestroy(stopLinks);
  }
}

function readIntroSeen(): boolean {
  try {
    return sessionStorage.getItem(INTRO_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeIntroSeen(): void {
  try {
    sessionStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    /* almacenamiento no disponible: la intro se vuelve a mostrar, sin errores */
  }
}
