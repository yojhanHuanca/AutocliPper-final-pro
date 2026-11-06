import { BrandComponent } from '../../shared/ui/brand/brand.component';
import { Component, DestroyRef, ElementRef, HostListener, ViewEncapsulation, inject, signal } from "@angular/core";
import { Router, RouterLink, RouterOutlet } from "@angular/router";
import { IconComponent } from "../../shared/ui/icon/icon.component";
import { interceptRouteLinks } from "../../shared/ui/route-transition";
@Component({
  selector: "ac-public-layout",
  imports: [BrandComponent, RouterLink, RouterOutlet, IconComponent],
  templateUrl: "./public-layout.component.html",
  styleUrl: "./public-layout.component.css",
  encapsulation: ViewEncapsulation.None,
})
export class PublicLayoutComponent {
  readonly menuOpen = signal(false);

  constructor() {
    // Todos los enlaces del layout y de las páginas de acceso cambian de página con transición.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const router = inject(Router);
    const stop = interceptRouteLinks(host, (url) => router.navigateByUrl(url));
    // El navbar se esconde al bajar y vuelve al subir, para no tapar el formulario.
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      host.classList.toggle("nav-hidden", y > lastY && y > 40);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    inject(DestroyRef).onDestroy(() => {
      stop();
      window.removeEventListener("scroll", onScroll);
    });
  }

  @HostListener("document:keydown.escape")
  closeMenu(): void {
    this.menuOpen.set(false);
  }
}
