import { Component, input } from "@angular/core";
import { RouterLink } from "@angular/router";
import { IconComponent } from "../icon/icon.component";

@Component({
  selector: "ac-account-section-nav",
  imports: [RouterLink, IconComponent],
  template: `<nav class="account-section-nav" aria-label="Configuración del estudio">
    <a [routerLink]="design() ? '/design/settings' : '/app/settings'" [class.active]="section() === 'account'" [attr.aria-current]="section() === 'account' ? 'page' : null"><ac-icon name="users" />Mi cuenta</a>
    <a [routerLink]="design() ? '/design/team' : '/app/team'" [class.active]="section() === 'team'" [attr.aria-current]="section() === 'team' ? 'page' : null"><ac-icon name="film" />Equipo y espacio</a>
  </nav>`,
  styles: [`:host { display:block; margin-bottom:28px; }
    .account-section-nav { display:flex; flex-wrap:wrap; gap:6px; width:fit-content; padding:5px; border:1px solid #dfe5ef; border-radius:11px; background:#f6f8fc; }
    .account-section-nav a { display:inline-flex; align-items:center; gap:9px; min-height:41px; padding:10px 17px; border:1px solid transparent; border-radius:7px; font-size:12px; font-weight:600; color:#6e7890; text-decoration:none; }
    .account-section-nav a.active { color:var(--accent); background:white; border-color:#d6e0f3; }
    .account-section-nav ac-icon { width:16px; height:16px; }
    .account-section-nav a:focus-visible { outline:3px solid var(--accent); outline-offset:3px; }
    @media(max-width:500px) { .account-section-nav { width:100%; } .account-section-nav a { flex:1; justify-content:center; padding-inline:11px; font-size:11px; } }
  `],
})
export class AccountSectionNavComponent {
  readonly design = input(false);
  readonly section = input<"account" | "team">("account");
}
