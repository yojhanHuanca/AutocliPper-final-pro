import { Component, DestroyRef, inject } from "@angular/core";
import { NavigationEnd, Router, RouterOutlet } from "@angular/router";
import { focusMain, changesPage } from "./core/a11y/navigation-focus";

@Component({
  selector: "app-root",
  imports: [RouterOutlet],
  template: `<a class="skip-link" href="#main" (click)="skipToMain($event)"
      >Saltar al contenido</a
    ><router-outlet />`,
})
export class AppComponent {
  constructor() {
    const router = inject(Router);
    const destroy = inject(DestroyRef);
    let previous = "";
    let frame = 0;
    const subscription = router.events.subscribe(event => {
      if (!(event instanceof NavigationEnd)) return;
      if (changesPage(previous, event.urlAfterRedirects)) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => focusMain(document, true));
      }
      previous = event.urlAfterRedirects;
    });
    destroy.onDestroy(() => { subscription.unsubscribe(); cancelAnimationFrame(frame); });
  }
  skipToMain(event: Event): void {
    event.preventDefault();
    focusMain(document, true);
  }
}
