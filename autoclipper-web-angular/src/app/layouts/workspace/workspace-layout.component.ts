import { BrandComponent } from '../../shared/ui/brand/brand.component';
import { ApiTransport } from "../../core/http/api-transport.service";
import { DESIGN_MODE } from "../../core/config/design-mode.token";
import { WorkspaceStore } from "../../features/workspaces/data-access/workspace.store";
import { ViewEncapsulation, Component, inject, signal } from "@angular/core";
import {
  ActivatedRoute,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from "@angular/router";
import { SessionStore } from "../../core/auth/session.store";
import { errorMessage } from "../../core/http/api-error";
import { IconComponent } from "../../shared/ui/icon/icon.component";

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-shell",
  providers: [
    {
      provide: DESIGN_MODE,
      useFactory: () => inject(ActivatedRoute).snapshot.data["design"] === true,
    },
  ],
  imports: [BrandComponent, RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  templateUrl: "./workspace-layout.component.html",
  styleUrl: "./workspace-layout.component.css",
})
export class WorkspaceLayoutComponent {
  readonly workspace = inject(WorkspaceStore);

  readonly session = inject(SessionStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ApiTransport);
  readonly design = this.route.snapshot.data["design"] === true;
  readonly base = this.design ? "/design" : "/app";
  readonly menuOpen = signal(false);
  readonly online = signal(false);
  readonly error = signal("");
  constructor() {
    if (!this.design)
      void this.api
        .get("/health/live")
        .then(() => this.online.set(true))
        .catch(() => this.online.set(false));
  }
  currentRole(): string {
    return (
      this.workspace
        .workspaces()
        .find((w) => w.id === this.workspace.workspaceId())?.role ?? "Cuenta"
    );
  }
  async logout(): Promise<void> {
    try {
      await this.session.logout();
      this.workspace.clear();
      await this.router.navigateByUrl("/login");
    } catch (error) {
      this.error.set(errorMessage(error));
    }
  }
}
