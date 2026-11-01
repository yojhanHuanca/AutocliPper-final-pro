import { Component, effect, inject, signal } from "@angular/core";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { EditorState } from "../../state/editor.state";
import { CollaborationApi } from "../../../collaboration/data-access/collaboration-api.service";
import type { Schema } from "../../../../core/contracts/api-types";
import { SessionStore } from "../../../../core/auth/session.store";
import { errorMessage } from "../../../../core/http/api-error";

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
  readonly linksError = signal("");
  readonly auditError = signal("");
  readonly reviewRetryError = signal("");
  readonly commentsRetryError = signal("");
  readonly reviewRetrying = signal(false);
  readonly commentsRetrying = signal(false);
  readonly reviewRetrySucceeded = signal(false);
  readonly commentsRetrySucceeded = signal(false);
  readonly pendingLinkRevocation = signal("");
  readonly pendingCommentRemoval = signal("");
  readonly pendingDecision = signal<"approve" | "return" | null>(null);
  readonly confirmedRevokedLinks = signal<ReadonlySet<string>>(new Set());
  readonly linksLoaded = signal(false);
  readonly auditLoaded = signal(false);
  expiresInSeconds = 86400;
  includeVideo = false;
  processingId = "";
  private activeEditId = this.vm.id;
  private resourceGeneration = 0;

  constructor() {
    effect(() => {
      const editId = this.vm.id;
      const canEdit = this.vm.canEditCollaboration();
      const canAdmin = this.vm.canAdminCollaboration();
      const notice = this.vm.loadNotice();
      const review = this.vm.review();
      const comments = this.vm.comments();
      if (editId !== this.activeEditId) {
        this.activeEditId = editId;
        this.resourceGeneration += 1;
        this.clearLinkData();
        this.clearAuditData();
        this.reviewRetryError.set("");
        this.commentsRetryError.set("");
        this.reviewRetrySucceeded.set(false);
        this.commentsRetrySucceeded.set(false);
        this.pendingDecision.set(null);
        this.pendingCommentRemoval.set("");
        return;
      }
      if (!canEdit) {
        this.clearLinkData();
        if (this.view() === "links") this.view.set("team");
      }
      if (!canAdmin) {
        this.clearAuditData();
        if (this.view() === "activity") this.view.set("team");
      }
      if (review?.status !== "review") this.pendingDecision.set(null);
      if (review) this.reviewRetrySucceeded.set(true);
      else if (notice.toLocaleLowerCase().includes("revisión") && !this.reviewRetrySucceeded())
        this.reviewRetryError.set("No se pudo confirmar el estado de revisión.");
      if (comments.length) this.commentsRetrySucceeded.set(true);
      else if (notice.toLocaleLowerCase().includes("comentarios") && !this.commentsRetrySucceeded())
        this.commentsRetryError.set("No se pudo confirmar la lista de observaciones.");
    });
  }

  private clearLinkData(): void {
    this.links.set([]);
    this.linksLoaded.set(false);
    this.loadingLinks.set(false);
    this.busy.set(false);
    this.createdLink.set(null);
    this.linksError.set("");
    this.pendingLinkRevocation.set("");
    this.confirmedRevokedLinks.set(new Set());
  }

  private clearAuditData(): void {
    this.audit.set([]);
    this.auditCursor.set(null);
    this.auditLoaded.set(false);
    this.loadingAudit.set(false);
    this.auditError.set("");
  }

  private isCurrentResource(editId: string, generation: number, permission: "editor" | "admin"): boolean {
    return editId === this.vm.id && generation === this.resourceGeneration &&
      (permission === "editor" ? this.vm.canEditCollaboration() : this.vm.canAdminCollaboration());
  }

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
    const editId = this.vm.id;
    const generation = this.resourceGeneration;
    this.loadingLinks.set(true);
    this.linksError.set("");
    try {
      const result = await this.api.links(editId);
      if (!this.isCurrentResource(editId, generation, "editor")) return;
      this.links.set(result.items);
      this.linksLoaded.set(true);
    } catch (error) {
      if (!this.isCurrentResource(editId, generation, "editor")) return;
      if (this.isAccessDenied(error)) this.clearLinkData();
      this.linksError.set(errorMessage(error));
    } finally { if (this.isCurrentResource(editId, generation, "editor")) this.loadingLinks.set(false); }
  }
  async createLink(): Promise<void> {
    const draft = this.vm.draft();
    if (!this.vm.canEditCollaboration() || !draft || this.vm.dirty() || this.busy()) return;
    if (this.includeVideo && !this.videoExports().some((item) => item.id === this.processingId)) {
      this.error.set("Elige una exportación de video completada para la revisión guardada actual.");
      return;
    }
    const editId = this.vm.id;
    const generation = this.resourceGeneration;
    this.busy.set(true); this.error.set(""); this.message.set("");
    try {
      const result = await this.api.createLink(editId, {
        revisionVersion: draft.version,
        expiresInSeconds: this.expiresInSeconds,
        ...(this.includeVideo ? { processingId: this.processingId } : {}),
      });
      if (!this.isCurrentResource(editId, generation, "editor")) return;
      // Bearer token stays in this component's memory and is never persisted or logged.
      this.createdLink.set(result);
      this.message.set("Enlace creado. Copia el acceso ahora; el token no vuelve a mostrarse.");
      await this.loadLinks();
    } catch (error) {
      if (this.isCurrentResource(editId, generation, "editor")) {
        this.error.set(errorMessage(error));
        if (this.isAccessDenied(error)) this.clearLinkData();
      }
    } finally { if (this.isCurrentResource(editId, generation, "editor")) this.busy.set(false); }
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
    const editId = this.vm.id;
    const generation = this.resourceGeneration;
    const confirmed = this.links().find((item) => item.id === link.id);
    if (this.vm.design || !this.vm.canEditCollaboration() || !this.linksLoaded() || !confirmed ||
      confirmed.revokedAt || this.linkStatus(confirmed) !== "Activo" ||
      this.pendingLinkRevocation() !== link.id || this.busy()) return;
    this.busy.set(true); this.error.set("");
    try {
      await this.api.revokeLink(editId, link.id);
      if (!this.isCurrentResource(editId, generation, "editor")) return;
      this.confirmedRevokedLinks.update((ids) => new Set([...ids, link.id]));
      this.pendingLinkRevocation.set("");
      this.message.set("Enlace revocado.");
      await this.loadLinks();
    } catch (error) {
      if (this.isCurrentResource(editId, generation, "editor")) {
        this.error.set(errorMessage(error));
        if (this.isAccessDenied(error)) this.clearLinkData();
      }
    } finally { if (this.isCurrentResource(editId, generation, "editor")) this.busy.set(false); }
  }
  linkStatus(link: Schema<"ReviewLinkDto">): string {
    if (this.confirmedRevokedLinks().has(link.id)) return "Revocado";
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
    const editId = this.vm.id;
    const generation = this.resourceGeneration;
    this.loadingAudit.set(true);
    this.auditError.set("");
    try {
      const page = await this.api.audit(editId, append ? this.auditCursor() : null);
      if (!this.isCurrentResource(editId, generation, "admin")) return;
      this.audit.set(append ? [...this.audit(), ...page.items] : page.items);
      this.auditCursor.set(page.nextBeforeId);
      this.auditLoaded.set(true);
    } catch (error) {
      if (!this.isCurrentResource(editId, generation, "admin")) return;
      if (this.isAccessDenied(error)) this.clearAuditData();
      this.auditError.set(errorMessage(error));
    } finally { if (this.isCurrentResource(editId, generation, "admin")) this.loadingAudit.set(false); }
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
  reviewUnavailable(): boolean {
    return !!this.reviewRetryError() ||
      (!this.reviewRetrySucceeded() && this.vm.loadNotice().toLocaleLowerCase().includes("revisión"));
  }
  commentsUnavailable(): boolean {
    return !!this.commentsRetryError() ||
      (!this.commentsRetrySucceeded() && this.vm.loadNotice().toLocaleLowerCase().includes("comentarios"));
  }
  async refreshReview(): Promise<void> {
    if (this.vm.design || this.reviewRetrying()) return;
    this.reviewRetrying.set(true);
    this.reviewRetryError.set("");
    this.reviewRetrySucceeded.set(false);
    try {
      await this.vm.loadReview();
      this.reviewRetrySucceeded.set(true);
    } catch (error) { this.reviewRetryError.set(errorMessage(error)); }
    finally { this.reviewRetrying.set(false); }
  }
  async refreshComments(): Promise<void> {
    if (this.vm.design || this.commentsRetrying()) return;
    this.commentsRetrying.set(true);
    this.commentsRetryError.set("");
    this.commentsRetrySucceeded.set(false);
    try {
      await this.vm.loadComments();
      this.commentsRetrySucceeded.set(true);
    } catch (error) { this.commentsRetryError.set(errorMessage(error)); }
    finally { this.commentsRetrying.set(false); }
  }
  requestLinkRevocation(link: Schema<"ReviewLinkDto">): void {
    const confirmed = this.links().find((item) => item.id === link.id);
    if (!this.vm.canEditCollaboration() || !this.linksLoaded() || !confirmed ||
        confirmed.revokedAt || this.linkStatus(confirmed) !== "Activo" || this.busy()) return;
    this.pendingLinkRevocation.set(link.id);
  }
  cancelLinkRevocation(): void { if (!this.busy()) this.pendingLinkRevocation.set(""); }
  requestCommentRemoval(item: Schema<"EditorCommentDto">): void {
    if (!this.canDeleteComment(item) || item.deletedAt || this.vm.busy()) return;
    this.pendingCommentRemoval.set(item.id);
  }
  cancelCommentRemoval(): void { if (!this.vm.busy()) this.pendingCommentRemoval.set(""); }
  async confirmCommentRemoval(item: Schema<"EditorCommentDto">): Promise<void> {
    if (this.pendingCommentRemoval() !== item.id || !this.canDeleteComment(item) || this.vm.busy()) return;
    await this.vm.deleteComment(item);
    if (this.vm.message() === "Comentario retirado.") this.pendingCommentRemoval.set("");
  }
  requestDecision(action: "approve" | "return"): void {
    if (!this.vm.canAdminCollaboration() || this.vm.busy() || this.vm.dirty() || this.vm.review()?.status !== "review") return;
    this.pendingDecision.set(action);
  }
  cancelDecision(): void { if (!this.vm.busy()) this.pendingDecision.set(null); }
  async confirmDecision(): Promise<void> {
    const action = this.pendingDecision();
    if (!action || !this.vm.canAdminCollaboration() || this.vm.busy() || this.vm.dirty() || this.vm.review()?.status !== "review") return;
    if (action === "approve") await this.vm.approve();
    else await this.vm.returnReview();
    if (this.vm.message() === (action === "approve" ? "Revisión aprobada." : "La revisión volvió al editor."))
      this.pendingDecision.set(null);
  }
  private isAccessDenied(error: unknown): boolean {
    return typeof error === "object" && error !== null && "status" in error &&
      [401, 403, 404].includes(Number(error.status));
  }
}
