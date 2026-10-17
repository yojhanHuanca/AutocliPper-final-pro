import { Component, inject, signal } from "@angular/core";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { EditorState } from "../../state/editor.state";
import { CollaborationApi } from "../../../collaboration/data-access/collaboration-api.service";
import type { Schema } from "../../../../core/contracts/api-types";
import { SessionStore } from "../../../../core/auth/session.store";

type CollaborationView = "team" | "links" | "activity";

@Component({
  selector: "ac-review-panel",
  imports: [FormsModule, DatePipe],
  templateUrl: "./review-panel.component.html",
  styleUrl: "./review-panel.component.css",
})
export class ReviewPanelComponent {
  readonly vm = inject(EditorState);
  private readonly session = inject(SessionStore);
  private readonly api = inject(CollaborationApi);
  readonly view = signal<CollaborationView>("team");
  readonly links = signal<Schema<"ReviewLinkDto">[]>([]);
  readonly audit = signal<Schema<"EditorAuditDto">[]>([]);
  readonly auditCursor = signal<string | null>(null);
  readonly createdLink = signal<Schema<"CreatedReviewLinkDto"> | null>(null);
  readonly busy = signal(false);
  readonly loadingLinks = signal(false);
  readonly loadingAudit = signal(false);
  readonly error = signal("");
  readonly message = signal("");
  readonly linksLoaded = signal(false);
  readonly auditLoaded = signal(false);
  expiresInSeconds = 86400;
  includeVideo = false;
  processingId = "";

  selectView(view: CollaborationView): void {
    if (view === "links" && !this.vm.canEditCollaboration()) return;
    if (view === "activity" && !this.vm.canAdminCollaboration()) return;
    this.view.set(view);
    if (this.vm.design) return;
    if (view === "links" && !this.linksLoaded()) void this.loadLinks();
    if (view === "activity" && !this.auditLoaded()) void this.loadAudit();
  }
  async loadLinks(): Promise<void> {
    if (this.vm.design || !this.vm.canEditCollaboration() || this.loadingLinks()) return;
    this.loadingLinks.set(true);
    this.error.set("");
    try {
      this.links.set((await this.api.links(this.vm.id)).items);
      this.linksLoaded.set(true);
    } catch (error) { this.error.set(this.errorText(error)); }
    finally { this.loadingLinks.set(false); }
  }
  async createLink(): Promise<void> {
    const draft = this.vm.draft();
    if (!this.vm.canEditCollaboration() || !draft || this.vm.dirty() || this.busy()) return;
    if (this.includeVideo && !this.videoExports().some((item) => item.id === this.processingId)) {
      this.error.set("Elige una exportación de video completada para la revisión guardada actual.");
      return;
    }
    this.busy.set(true); this.error.set(""); this.message.set("");
    try {
      const result = await this.api.createLink(this.vm.id, {
        revisionVersion: draft.version,
        expiresInSeconds: this.expiresInSeconds,
        ...(this.includeVideo ? { processingId: this.processingId } : {}),
      });
      // Bearer token stays in this component's memory and is never persisted or logged.
      this.createdLink.set(result);
      this.message.set("Enlace creado. Copia el acceso ahora; el token no vuelve a mostrarse.");
      await this.loadLinks();
    } catch (error) { this.error.set(this.errorText(error)); }
    finally { this.busy.set(false); }
  }
  dismissCreatedLink(): void { this.createdLink.set(null); this.message.set(""); }
  publicUrl(): string {
    const token = this.createdLink()?.token;
    return token ? `${window.location.origin}/review/${encodeURIComponent(token)}` : "";
  }
  async copyLink(): Promise<void> {
    const url = this.publicUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.message.set("Enlace copiado. Comparte este acceso solo con su destinatario.");
    } catch { this.error.set("No se pudo copiar automáticamente. Selecciona y copia el enlace mostrado."); }
  }
  async revoke(link: Schema<"ReviewLinkDto">): Promise<void> {
    if (this.vm.design || !this.vm.canEditCollaboration() || link.revokedAt || this.busy()) return;
    this.busy.set(true); this.error.set("");
    try {
      await this.api.revokeLink(this.vm.id, link.id);
      await this.loadLinks();
      this.message.set("Enlace revocado.");
    } catch (error) { this.error.set(this.errorText(error)); }
    finally { this.busy.set(false); }
  }
  linkStatus(link: Schema<"ReviewLinkDto">): string {
    if (link.revokedAt) return "Revocado";
    return Date.parse(link.expiresAt) <= Date.now() ? "Vencido" : "Activo";
  }
  reviewStatus(status: Schema<"ReviewHistoryDto">["status"]): string {
    return { draft: "Borrador", review: "En revisión", approved: "Aprobada" }[status];
  }
  videoExports(): Schema<"EditorExportDto">[] {
    const revisionId = this.vm.draft()?.revision.id;
    if (!revisionId) return [];
    return this.vm.exports().filter((item) =>
      item.editorRevisionId === revisionId && item.status === "succeeded" &&
      item.artifacts.some((artifact) => artifact.kind === "video"),
    );
  }
  roleMessage(): string {
    const role = this.vm.collaborationRole();
    if (role === "loading") return "Cargando tu rol en el espacio de este proyecto…";
    if (role === "unavailable") return "No pudimos determinar tu rol para este proyecto. Las acciones restringidas no están disponibles.";
    if (role === "reader") return "Acceso de lectura: puedes consultar la revisión y sus observaciones. Solicitar cambios requiere el rol editor.";
    if (role === "editor") return "Como editor puedes solicitar revisión, comentar y compartir enlaces. Aprobar y consultar actividad requiere administración.";
    return "Tu rol de administración permite revisar, aprobar y consultar la actividad.";
  }
  canDeleteComment(item: Schema<"EditorCommentDto">): boolean {
    const role = this.vm.collaborationRole();
    return role === "owner" || role === "admin" ||
      (role === "editor" && item.authorId === this.session.user()?.id);
  }
  async loadAudit(append = false): Promise<void> {
    if (this.vm.design || !this.vm.canAdminCollaboration() || this.loadingAudit()) return;
    this.loadingAudit.set(true);
    this.error.set("");
    try {
      const page = await this.api.audit(this.vm.id, append ? this.auditCursor() : null);
      this.audit.set(append ? [...this.audit(), ...page.items] : page.items);
      this.auditCursor.set(page.nextBeforeId);
      this.auditLoaded.set(true);
    } catch (error) { this.error.set(this.errorText(error)); }
    finally { this.loadingAudit.set(false); }
  }
  actionLabel(action: Schema<"EditorAuditDto">["action"]): string {
    const labels: Record<Schema<"EditorAuditDto">["action"], string> = {
      "revision.created": "Borrador creado", "revision.updated": "Revisión actualizada",
      "revision.restored": "Revisión restaurada", "comment.created": "Comentario añadido",
      "comment.deleted": "Comentario retirado", "review.requested": "Revisión solicitada",
      "review.returned": "Devuelto al editor", "review.approved": "Revisión aprobada",
      "link.created": "Enlace externo creado", "link.revoked": "Enlace externo revocado",
    };
    return labels[action] ?? "Actividad";
  }
  auditDetails(event: Schema<"EditorAuditDto">): string {
    const allowed = ["version", "revisionVersion", "reviewVersion", "commentId", "linkId"];
    return allowed.filter((key) => key in event.details)
      .map((key) => `${key}: ${String(event.details[key])}`).join(" · ");
  }
  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : "No se pudo completar la operación.";
  }
}
