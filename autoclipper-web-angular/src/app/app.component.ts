import { Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";

@Component({
  selector: "app-root",
  imports: [RouterOutlet],
  template: `<a class="skip-link" href="#main" (click)="skipToMain($event)"
      >Saltar al contenido</a
    ><router-outlet />`,
})
export class AppComponent {
  skipToMain(event: Event): void {
    event.preventDefault();
    const main = document.getElementById("main");
    if (main) {
      main.tabIndex = -1;
      main.focus();
      main.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }
}
