import { DatePipe } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import { Component, DestroyRef, ViewEncapsulation, computed, effect, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { AccountSectionNavComponent } from '../../../shared/ui/account-section-nav/account-section-nav.component';
import { DESIGN_MODE } from "../../../core/config/design-mode.token";
import { SessionStore } from "../../../core/auth/session.store";
import { errorMessage } from "../../../core/http/api-error";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { WorkspaceStore } from "../data-access/workspace.store";
import { WorkspaceTeamApi } from "../data-access/workspace-team.api";
import type { Schema } from "../../../core/contracts/api-types";
import { canInviteAs as roleCanInviteAs, canManageMember as roleCanManageMember, canManageWorkspace, canTransferOwnership, type AssignableWorkspaceRole, type WorkspaceRole } from "../models/workspace-permissions";
import { workspaceRoleLabel } from "../../../core/labels/workspace-role-label";
import { parseWorkspaceInvitations, workspaceInvitationStatus, type WorkspaceInvitation } from "../models/workspace-invitations";

function isRecordWithRevokedTrue(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (value as Record<string, unknown>)["revoked"] === true;
}

function hasAccessDeniedStatus(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403 || status === 404;
}

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-workspace-team",
  imports: [FormsModule, DatePipe, IconComponent, RouterLink, AccountSectionNavComponent],
  templateUrl: "./workspace-team.component.html",
  styleUrl: "./workspace-team.component.css",
})
export class WorkspaceTeamComponent {
  readonly workspaceStore = inject(WorkspaceStore);
  private readonly api = inject(WorkspaceTeamApi);
  private readonly session = inject(SessionStore);
  private readonly destroy = inject(DestroyRef);
  readonly design = inject(DESIGN_MODE);
  readonly activeWorkspace = computed(() => this.workspaceStore.workspaces().find((workspace) => workspace.id === this.workspaceStore.workspaceId()) ?? null);
  readonly actorRole = computed<WorkspaceRole | null>(() => this.activeWorkspace()?.role ?? null);
  readonly pageTitle = computed(() => {
    if (this.design) return "Equipo y permisos";
    const active = this.activeWorkspace();
    if (active?.kind === "team") return "Personas y permisos del equipo";
    if (active?.kind === "personal") return "Tu espacio personal";
    if (!this.workspaceStore.loaded()) return "Consultando espacios";
    return this.workspaceStore.workspaces().length ? "Selecciona un espacio" : "Sin espacios disponibles";
  });
  readonly pageDescription = computed(() => {
    if (this.design) return "Conecta una cuenta para consultar miembros, roles e invitaciones reales.";
    const active = this.activeWorkspace();
    if (active?.kind === "team") return "Consulta quién tiene acceso, confirma los permisos y administra las invitaciones compatibles con tu rol.";
    if (active?.kind === "personal") return "Consulta tu acceso o crea un espacio compartido para colaborar con otras personas.";
    return this.workspaceStore.loaded() ? "Elige un espacio en la barra lateral para consultar sus miembros y permisos." : "Estamos verificando los espacios disponibles para tu cuenta.";
  });
  readonly workspacePermissionsUnconfirmed = signal(false);
  readonly workspaceListRefreshFailed = signal(false);
  readonly canManage = computed(() => !this.design && !this.forbidden() && !this.workspacePermissionsUnconfirmed() && !this.loading() && this.actorRole() !== null && canManageWorkspace(this.actorRole()!));
  readonly canTransfer = computed(() => {
    const active = this.activeWorkspace();
    const role = this.actorRole();
    return !this.design && !this.forbidden() && !this.workspacePermissionsUnconfirmed() && !this.loading() && this.membersLoaded() && !!active && !!role && canTransferOwnership(role, active.kind);
  });
  readonly members = signal<Schema<"MemberDto">[]>([]);
  readonly loading = signal(false);
  readonly membersLoaded = signal(false);
  readonly error = signal("");
  readonly forbidden = signal(false);
  readonly message = signal("");
  readonly mutationBusy = signal(false);
  readonly workspaceRefreshBusy = signal(false);
  readonly roleDrafts = signal<Record<string, AssignableWorkspaceRole>>({});
  readonly invitations = signal<WorkspaceInvitation[]>([]);
  readonly invitationsLoading = signal(false);
  readonly invitationsLoaded = signal(false);
  readonly invitationsError = signal("");
  readonly pendingInvitationRevocation = signal("");
  readonly pendingRemoval = signal("");
  readonly transferTarget = signal("");
  readonly transferConfirmation = signal(false);
  teamName = "";
  private readonly invitationDrafts = new Map<string, { email: string; role: AssignableWorkspaceRole; idempotencyKey: string; fingerprint: string }>();
  get inviteEmail(): string { return this.invitationDraftForActiveWorkspace()?.email ?? ""; }
  set inviteEmail(email: string) { this.updateInvitationDraft({ email }); }
  get inviteRole(): AssignableWorkspaceRole { return this.invitationDraftForActiveWorkspace()?.role ?? "editor"; }
  set inviteRole(role: AssignableWorkspaceRole) { this.updateInvitationDraft({ role }); }
  createBusy = false;
  get inviteKey(): string { return this.invitationDraftForActiveWorkspace()?.idempotencyKey ?? ""; }
  set inviteKey(idempotencyKey: string) { this.updateInvitationDraft({ idempotencyKey }); }
  get inviteFingerprint(): string { return this.invitationDraftForActiveWorkspace()?.fingerprint ?? ""; }
  set inviteFingerprint(fingerprint: string) { this.updateInvitationDraft({ fingerprint }); }
  private requestVersion = 0;
  private invitationRequestVersion = 0;
  private destroyed = false;

  readonly capabilities = [
    { role: "Propietario", detail: "Puede crear y editar clips, gestionar el equipo y transferir la propiedad." },
    { role: "Administrador", detail: "Puede crear y editar clips e invitar o gestionar miembros. No puede cambiar ni transferir la propiedad." },
    { role: "Editor", detail: "Puede cargar y procesar videos, editar clips y solicitar revisiones." },
    { role: "Lector", detail: "Puede consultar proyectos, comentarios y exportaciones. No puede cargar ni editar clips." },
  ];
  readonly teamWorkflow = [
    { step: "01", title: "Preparar el video", access: "Editor · Administrador · Propietario", detail: "Cargar la fuente e iniciar el procesamiento." },
    { step: "02", title: "Editar y solicitar revisión", access: "Editor · Administrador · Propietario", detail: "Ajustar el clip y enviarlo a revisión." },
    { step: "03", title: "Consultar resultados", access: "Todos los roles", detail: "Ver proyectos, comentarios y exportaciones compartidas." },
  ];

  private invitationDraftForActiveWorkspace(): { email: string; role: AssignableWorkspaceRole; idempotencyKey: string; fingerprint: string } | undefined {
    const workspaceId = this.workspaceStore.workspaceId();
    return workspaceId ? this.invitationDrafts.get(workspaceId) : undefined;
  }

  private updateInvitationDraft(update: Partial<{ email: string; role: AssignableWorkspaceRole; idempotencyKey: string; fingerprint: string }>): void {
    const workspaceId = this.workspaceStore.workspaceId();
    if (!workspaceId) return;
    const current = this.invitationDrafts.get(workspaceId) ?? { email: "", role: "editor" as const, idempotencyKey: "", fingerprint: "" };
    this.invitationDrafts.set(workspaceId, { ...current, ...update });
  }

  constructor() {
    effect(() => {
      const workspaceId = this.workspaceStore.workspaceId();
      const version = ++this.requestVersion;
      this.invitationRequestVersion += 1;
      this.workspacePermissionsUnconfirmed.set(false);
      this.workspaceListRefreshFailed.set(false);
      this.members.set([]);
      this.membersLoaded.set(false);
      this.roleDrafts.set({});
      this.error.set("");
      this.message.set("");
      this.forbidden.set(false);
      this.pendingRemoval.set("");
      this.transferTarget.set("");
      this.transferConfirmation.set(false);
      this.invitations.set([]);
      this.invitationsLoading.set(false);
      this.invitationsLoaded.set(false);
      this.invitationsError.set("");
      this.pendingInvitationRevocation.set("");
      if (!workspaceId || this.design) {
        this.loading.set(false);
        return;
      }
      void this.loadMembers(workspaceId, version);
    });
    this.destroy.onDestroy(() => { this.destroyed = true; this.requestVersion += 1; this.invitationRequestVersion += 1; this.invitationDrafts.clear(); });
  }

  async refresh(): Promise<void> {
    const workspaceId = this.workspaceStore.workspaceId();
    if (!workspaceId || this.design) return;
    const version = ++this.requestVersion;
    this.error.set("");
    this.message.set("");
    await this.loadMembers(workspaceId, version);
  }

  async refreshWorkspaces(): Promise<void> {
    if (this.design || this.workspaceRefreshBusy()) return;
    const workspaceId = this.workspaceStore.workspaceId();
    this.workspaceRefreshBusy.set(true);
    this.workspacePermissionsUnconfirmed.set(true);
    this.workspaceListRefreshFailed.set(false);
    this.error.set("");
    try {
      const confirmed = await this.workspaceStore.loadWorkspaces();
      if (confirmed === false) throw new Error("Otra consulta reemplazó la actualización de espacios. Vuelve a intentarlo.");
      if (workspaceId && workspaceId === this.workspaceStore.workspaceId() && this.isActiveWorkspace(workspaceId)) {
        this.workspacePermissionsUnconfirmed.set(false);
        this.workspaceListRefreshFailed.set(false);
        await this.refresh();
      }
    } catch (error) {
      if (workspaceId === this.workspaceStore.workspaceId() && !this.destroyed) {
        this.workspacePermissionsUnconfirmed.set(true);
        this.workspaceListRefreshFailed.set(true);
        this.error.set(`No se pudieron actualizar los espacios: ${errorMessage(error)}`);
      }
    } finally {
      this.workspaceRefreshBusy.set(false);
    }
  }

  private async loadMembers(workspaceId: string, version: number): Promise<void> {
    this.loading.set(true);
    this.membersLoaded.set(false);
    try {
      const result = await this.api.members(workspaceId);
      if (version !== this.requestVersion || workspaceId !== this.workspaceStore.workspaceId()) return;
      this.members.set(result.items);
      this.membersLoaded.set(true);
      this.roleDrafts.set(Object.fromEntries(result.items.map((member) => [member.userId, member.role === "owner" ? "reader" : member.role])));
      this.forbidden.set(false);
      const workspace = this.activeWorkspace();
      if (workspace?.kind === "team" && canManageWorkspace(workspace.role)) void this.loadInvitations(workspaceId);
      else this.clearInvitations();
    } catch (error) {
      if (version !== this.requestVersion || workspaceId !== this.workspaceStore.workspaceId()) return;
      this.forbidden.set(error instanceof HttpErrorResponse && error.status === 403);
      if (error instanceof HttpErrorResponse && [401, 403, 404].includes(error.status)) {
        this.forbidden.set(true);
        this.members.set([]);
        this.roleDrafts.set({});
        this.pendingRemoval.set("");
        this.transferTarget.set("");
        this.transferConfirmation.set(false);
        this.clearInvitations();
      }
      this.error.set(this.forbidden() ? "Tu cuenta ya no tiene acceso a este espacio. Elige otro espacio y vuelve a intentarlo." : errorMessage(error));
    } finally {
      if (version === this.requestVersion && workspaceId === this.workspaceStore.workspaceId()) this.loading.set(false);
    }
  }

  roleLabel(role: WorkspaceRole): string {
    return workspaceRoleLabel(role);
  }
  activePermissionLabel(): string {
    if (this.forbidden()) return "Sin acceso confirmado";
    if (this.workspacePermissionsUnconfirmed() || this.workspaceListRefreshFailed()) return "Por confirmar";
    const role = this.activeWorkspace()?.role;
    return role ? this.roleLabel(role) : "Sin rol confirmado";
  }
  roleDraft(member: Schema<"MemberDto">): AssignableWorkspaceRole {
    return this.roleDrafts()[member.userId] ?? (member.role === "owner" ? "reader" : member.role);
  }
  setRoleDraft(userId: string, value: string): void {
    if (value === "admin" || value === "editor" || value === "reader") this.roleDrafts.update((drafts) => ({ ...drafts, [userId]: value }));
  }
  canManageMember(member: Schema<"MemberDto">): boolean {
    const actor = this.actorRole();
    const confirmedMember = this.members().find((item) => item.userId === member.userId);
    return this.membersLoaded() && !!confirmedMember && confirmedMember.role === member.role && this.canManage() && !!actor && roleCanManageMember(actor, member.role);
  }
  roleOptions(member: Schema<"MemberDto">): AssignableWorkspaceRole[] {
    return this.actorRole() === "owner" ? ["admin", "editor", "reader"] : member.role === "admin" ? [] : ["editor", "reader"];
  }
  canInviteSelected(): boolean {
    const actor = this.actorRole();
    return this.canManage() && !!actor && roleCanInviteAs(actor, this.inviteRole);
  }
  isCurrentMember(member: Schema<"MemberDto">): boolean {
    return member.userId === this.session.user()?.id;
  }
  memberDisplayName(member: Schema<"MemberDto">): string {
    return this.isCurrentMember(member) ? this.session.user()?.name || "Tu cuenta" : `Cuenta …${member.userId.slice(-8)}`;
  }
  focusSection(id: "team-invite-email" | "team-members-section"): void {
    const target = document.getElementById(id);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "center", behavior: "instant" });
  }
  private isActiveWorkspace(workspaceId: string): boolean {
    return !this.destroyed && !this.design && !!workspaceId && workspaceId === this.workspaceStore.workspaceId();
  }
  invitationStatus(invitation: WorkspaceInvitation): "pending" | "accepted" | "expired" | "revoked" {
    return workspaceInvitationStatus(invitation);
  }
  invitationStatusLabel(invitation: WorkspaceInvitation): string {
    const labels = { pending: "Pendiente", accepted: "Aceptada", expired: "Vencida", revoked: "Revocada" };
    return labels[this.invitationStatus(invitation)];
  }
  private clearInvitations(): void {
    this.invitationRequestVersion += 1;
    this.invitations.set([]);
    this.invitationsLoaded.set(false);
    this.invitationsLoading.set(false);
    this.invitationsError.set("");
    this.pendingInvitationRevocation.set("");
  }
  private markWorkspacePermissionsUnconfirmed(error: unknown): void {
    if (!hasAccessDeniedStatus(error)) return;
    this.workspacePermissionsUnconfirmed.set(true);
    this.workspaceListRefreshFailed.set(false);
    this.error.set("El servidor ya no confirma el acceso o los permisos de este espacio. Actualiza los espacios antes de seguir gestionándolo.");
  }
  async loadInvitations(workspaceId = this.workspaceStore.workspaceId()): Promise<void> {
    const workspace = this.activeWorkspace();
    if (!workspaceId || !this.isActiveWorkspace(workspaceId) || workspace?.id !== workspaceId || workspace.kind !== "team" || !canManageWorkspace(workspace.role)) return;
    const version = ++this.invitationRequestVersion;
    this.invitationsLoading.set(true);
    this.invitationsLoaded.set(false);
    this.pendingInvitationRevocation.set("");
    this.invitationsError.set("");
    try {
      const result = await this.api.invitations(workspaceId);
      const rows = parseWorkspaceInvitations(result);
      if (version !== this.invitationRequestVersion || !this.isActiveWorkspace(workspaceId)) return;
      this.invitations.set(rows);
      this.invitationsLoaded.set(true);
    } catch (error) {
      if (version !== this.invitationRequestVersion || !this.isActiveWorkspace(workspaceId)) return;
      if (hasAccessDeniedStatus(error)) {
        this.invitations.set([]);
        this.pendingInvitationRevocation.set("");
        this.markWorkspacePermissionsUnconfirmed(error);
      }
      this.invitationsError.set(errorMessage(error));
    } finally {
      if (version === this.invitationRequestVersion && this.isActiveWorkspace(workspaceId)) this.invitationsLoading.set(false);
    }
  }
  async revokeInvitation(invitation: WorkspaceInvitation): Promise<void> {
    const workspace = this.activeWorkspace();
    const confirmedInvitation = this.invitations().find((item) => item.id === invitation.id);
    if (this.design || !workspace || workspace.kind !== "team" || !this.canManage() || !canManageWorkspace(workspace.role)
      || !this.invitationsLoaded() || !confirmedInvitation || confirmedInvitation.email !== invitation.email
      || this.mutationBusy() || this.pendingInvitationRevocation() !== invitation.id
      || workspaceInvitationStatus(confirmedInvitation) !== "pending") return;
    const workspaceId = workspace.id;
    this.mutationBusy.set(true);
    this.error.set(""); this.message.set("");
    try {
      const result = await this.api.revokeInvitation(workspaceId, invitation.id);
      if (!this.isActiveWorkspace(workspaceId)) return;
      if (!isRecordWithRevokedTrue(result)) throw new Error("El servidor no confirmó la revocación de la invitación.");
      this.pendingInvitationRevocation.set("");
      this.message.set(`Invitación para ${invitation.email} revocada.`);
      await this.loadInvitations(workspaceId);
    } catch (error) {
      if (this.isActiveWorkspace(workspaceId)) {
        this.invitationsError.set(errorMessage(error));
        this.markWorkspacePermissionsUnconfirmed(error);
      }
    } finally { this.mutationBusy.set(false); }
  }
  async createTeam(): Promise<void> {
    if (this.design || this.destroyed || this.createBusy || !this.teamName.trim()) return;
    this.createBusy = true;
    this.error.set(""); this.message.set("");
    try {
      await this.workspaceStore.createTeam(this.teamName.trim());
      this.teamName = "";
      this.message.set("Espacio creado. Ya está seleccionado para que configures el equipo.");
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.createBusy = false; }
  }
  async invite(): Promise<void> {
    const workspace = this.activeWorkspace();
    if (this.design || !workspace || workspace.kind !== "team" || !this.canManage() || !roleCanInviteAs(this.actorRole()!, this.inviteRole) || this.mutationBusy()) return;
    const email = this.inviteEmail.trim().toLowerCase();
    const fingerprint = `${workspace.id}|${email}|${this.inviteRole}`;
    if (fingerprint !== this.inviteFingerprint || !this.inviteKey) {
      this.inviteFingerprint = fingerprint;
      this.inviteKey = crypto.randomUUID();
    }
    this.mutationBusy.set(true); this.error.set(""); this.message.set("");
    try {
      await this.api.invite(workspace.id, { email, role: this.inviteRole }, this.inviteKey);
      if (!this.isActiveWorkspace(workspace.id)) return;
      this.inviteKey = ""; this.inviteFingerprint = ""; this.inviteEmail = "";
      this.message.set(`Invitación registrada para ${email}. La persona debe aceptar el enlace con esa misma cuenta. La entrega del correo depende del servicio de envío.`);
      await this.loadInvitations(workspace.id);
    } catch (error) { if (this.isActiveWorkspace(workspace.id)) { this.error.set(errorMessage(error)); this.markWorkspacePermissionsUnconfirmed(error); } }
    finally { this.mutationBusy.set(false); }
  }
  async saveRole(member: Schema<"MemberDto">): Promise<void> {
    const workspaceId = this.workspaceStore.workspaceId();
    const role = this.roleDraft(member);
    if (this.design || !workspaceId || !this.canManageMember(member) || !roleCanInviteAs(this.actorRole()!, role) || role === member.role || this.mutationBusy()) return;
    this.mutationBusy.set(true); this.error.set(""); this.message.set("");
    try {
      await this.api.setRole(workspaceId, member.userId, role);
      if (!this.isActiveWorkspace(workspaceId)) return;
      await this.refreshAfterMutation(workspaceId, "Rol actualizado.");
    } catch (error) { if (this.isActiveWorkspace(workspaceId)) { this.error.set(errorMessage(error)); this.markWorkspacePermissionsUnconfirmed(error); } }
    finally { this.mutationBusy.set(false); }
  }
  async confirmRemove(member: Schema<"MemberDto">): Promise<void> {
    const workspaceId = this.workspaceStore.workspaceId();
    if (this.design || !workspaceId || !this.canManageMember(member) || this.pendingRemoval() !== member.userId || this.mutationBusy()) return;
    this.mutationBusy.set(true); this.error.set(""); this.message.set("");
    try {
      await this.api.remove(workspaceId, member.userId);
      if (!this.isActiveWorkspace(workspaceId)) return;
      this.pendingRemoval.set("");
      await this.refreshAfterMutation(workspaceId, this.isCurrentMember(member) ? "Tu cuenta salió del espacio." : "Miembro retirado del espacio.");
    } catch (error) { if (this.isActiveWorkspace(workspaceId)) { this.error.set(errorMessage(error)); this.markWorkspacePermissionsUnconfirmed(error); } }
    finally { this.mutationBusy.set(false); }
  }
  async transferOwnership(): Promise<void> {
    const workspaceId = this.workspaceStore.workspaceId();
    const target = this.members().find((member) => member.userId === this.transferTarget());
    if (this.design || !workspaceId || !target || target.role === "owner" || this.isCurrentMember(target) || !this.canTransfer() || !this.transferConfirmation() || this.mutationBusy()) return;
    this.mutationBusy.set(true); this.error.set(""); this.message.set("");
    try {
      await this.api.transfer(workspaceId, target.userId);
      if (!this.isActiveWorkspace(workspaceId)) return;
      this.transferConfirmation.set(false);
      this.transferTarget.set("");
      await this.refreshAfterMutation(workspaceId, `La propiedad ahora pertenece a la cuenta ${target.userId.slice(0, 8)}.`);
    } catch (error) { if (this.isActiveWorkspace(workspaceId)) { this.error.set(errorMessage(error)); this.markWorkspacePermissionsUnconfirmed(error); } }
    finally { this.mutationBusy.set(false); }
  }
  private async refreshAfterMutation(workspaceId: string, success: string): Promise<void> {
    if (!this.isActiveWorkspace(workspaceId)) return;
    this.message.set(success);
    this.workspacePermissionsUnconfirmed.set(true);
    this.workspaceListRefreshFailed.set(false);
    try {
      const confirmed = await this.workspaceStore.loadWorkspaces();
      if (confirmed === false) throw new Error("Otra consulta reemplazó la actualización de espacios. Vuelve a intentarlo.");
    } catch (error) {
      if (this.isActiveWorkspace(workspaceId)) {
        this.workspaceListRefreshFailed.set(true);
        this.error.set(`El cambio se guardó, pero no se pudo actualizar la lista de espacios: ${errorMessage(error)}`);
      }
      return;
    }
    if (!this.isActiveWorkspace(workspaceId)) return;
    this.workspacePermissionsUnconfirmed.set(false);
    this.workspaceListRefreshFailed.set(false);
    await this.refresh();
    if (this.isActiveWorkspace(workspaceId) && !this.error()) this.message.set(success);
  }
}
