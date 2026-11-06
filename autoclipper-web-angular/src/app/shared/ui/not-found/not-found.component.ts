import { Component, inject } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { IconComponent } from "../icon/icon.component";

export function notFoundProjectsRoute(url: string): string {
  const path = url.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  return path === "/design" || path.startsWith("/design/")
    ? "/design/projects"
    : "/app/projects";
}

@Component({
  selector: "ac-not-found",
  imports: [RouterLink, IconComponent],
  template: `<main id="main" class="not-found" tabindex="-1" aria-labelledby="not-found-title" aria-describedby="not-found-description">
    <section class="not-found-card">
      <span class="not-found-mark" aria-hidden="true"><ac-icon name="scissors" /></span>
      <span class="eyebrow">404 / ESTE CORTE NO EXISTE</span>
      <h1 id="not-found-title">Volvamos a la historia.</h1>
      <p id="not-found-description">No encontramos esta página. Puedes abrir tus proyectos o regresar al inicio.</p>
      <nav class="not-found-actions" aria-label="Opciones para continuar">
        <a class="button primary" [routerLink]="projectsRoute">Ir a Proyectos<ac-icon name="arrow" /></a>
        <a class="button" routerLink="/">Volver al inicio</a>
      </nav>
    </section>
  </main>`,
  styles: [`
    :host { display: block; min-height: 100dvh; background: var(--bg); }
    .not-found { min-height: 100dvh; display: grid; place-items: center; padding: clamp(20px, 5vw, 64px); color: var(--text); outline: none; }
    .not-found-card { width: min(100%, 620px); padding: clamp(28px, 6vw, 56px); border: 1px solid var(--border); border-radius: 18px; background: #fff; box-shadow: 0 20px 60px #192b4b0d; }
    .not-found-mark { display: grid; place-items: center; width: 48px; height: 48px; margin-bottom: 24px; border-radius: 12px; color: var(--accent); background: var(--tint); }
    .not-found-mark ac-icon { width: 23px; height: 23px; }
    .not-found h1 { margin: 10px 0 12px; font-size: clamp(30px, 5vw, 46px); line-height: 1.08; letter-spacing: -0.045em; }
    .not-found p { max-width: 46ch; margin: 0; color: var(--muted); font-size: 15px; line-height: 1.7; }
    .not-found-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
    .not-found-actions a:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
    @media (max-width: 480px) { .not-found-card { border-radius: 14px; } .not-found-actions { align-items: stretch; flex-direction: column; } .not-found-actions .button { justify-content: center; } }
  `],
})
export class NotFoundComponent {
  readonly projectsRoute = notFoundProjectsRoute(inject(Router).url);
}
