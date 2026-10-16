import { Component } from "@angular/core";
import { RouterLink } from "@angular/router";
import { IconComponent } from "../icon/icon.component";
@Component({
  selector: "ac-not-found",
  imports: [RouterLink, IconComponent],
  template: `<main id="main" class="not-found">
    <ac-icon name="scissors" /><span class="eyebrow"
      >404 / ESTE CORTE NO EXISTE</span
    >
    <h1>Volvamos a la historia.</h1>
    <p>No encontramos esta página.</p>
    <a class="button primary" routerLink="/"
      >Ir al inicio<ac-icon name="arrow"
    /></a>
  </main>`,
})
export class NotFoundComponent {}
