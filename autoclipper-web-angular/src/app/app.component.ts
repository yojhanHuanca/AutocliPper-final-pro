import { ConfirmationComponent } from './shared/ui/confirmation/confirmation.component';
import { Component, DestroyRef, inject, signal } from "@angular/core";
import { NavigationEnd, NavigationStart, NavigationCancel, NavigationError, Router, RouterOutlet } from "@angular/router";
import { focusMain, changesPage } from "./core/a11y/navigation-focus";

@Component({
  selector: "app-root",
  imports: [RouterOutlet, ConfirmationComponent],
  template: `<a class="skip-link" href="#main" (click)="skipToMain($event)"
      >Saltar al contenido</a
    ><router-outlet /><ac-confirmation />@if (navigating()) { <div class="studio-route-progress" role="status" aria-label="Abriendo página"><span></span></div> }`,
})
export class AppComponent {
  readonly navigating = signal(false);
  constructor() {
    const router = inject(Router);
    const destroy = inject(DestroyRef);
    let previous = "";
    let frame = 0;
    const subscription = router.events.subscribe(event => {
      if (event instanceof NavigationStart) this.navigating.set(true);
      if (event instanceof NavigationEnd || event instanceof NavigationCancel || event instanceof NavigationError) this.navigating.set(false);
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
