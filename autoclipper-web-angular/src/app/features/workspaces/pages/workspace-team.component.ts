import { DatePipe } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import { Component, DestroyRef, ViewEncapsulation, computed, effect, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DESIGN_MODE } from "../../../core/config/design-mode.token";
import { SessionStore } from "../../../core/auth/session.store";
import { errorMessage } from "../../../core/http/api-error";
import { IconComponent } from "../../../shared/ui/icon/icon.component";
import { WorkspaceStore } from "../data-access/workspace.store";
import { WorkspaceTeamApi } from "../data-access/workspace-team.api";
import type { Schema } from "../../../core/contracts/api-types";
import { canInviteAs as roleCanInviteAs, canManageMember as roleCanManageMember, canManageWorkspace, canTransferOwnership, type AssignableWorkspaceRole, type WorkspaceRole } from "../models/workspace-permissions";

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-workspace-team",
  imports: [FormsModule, DatePipe, IconComponent],
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
  readonly canManage = computed(() => this.actorRole() !== null && canManageWorkspace(this.actorRole()!));
  readonly canTransfer = computed(() => {
    const active = this.activeWorkspace();
    const role = this.actorRole();
    return !!active && !!role && canTransferOwnership(role, active.kind);
  });
  readonly members = signal<Schema<"MemberDto">[]>([]);
  readonly loading = signal(false);
  readonly error = signal("");
  readonly forbidden = signal(false);
  readonly message = signal("");
  readonly mutationBusy = signal(false);
  readonly roleDrafts = signal<Record<string, AssignableWorkspaceRole>>({});
  readonly pendingRemoval = signal("");
  readonly transferTarget = signal("");
  readonly transferConfirmation = signal(false);
  teamName = "";
  inviteEmail = "";
  inviteRole: AssignableWorkspaceRole = "editor";
  createBusy = false;
  inviteKey = "";
  inviteFingerprint = "";
  private requestVersion = 0;

  readonly capabilities = [
    { role: "Propietario", detail: "Administra el equipo y puede transferir la propiedad." },
    { role: "Administrador", detail: "Invita y gestiona miembros; no cambia propietarios ni transfiere el espacio." },
    { role: "Editor", detail: "Sube material, edita y solicita revisiones." },
    { role: "Lector", detail: "Consulta proyectos y revisiones compartidas." },
  ];

  constructor() {
    effect(() => {
      const workspaceId = this.workspaceStore.workspaceId();
      const version = ++this.requestVersion;
      this.members.set([]);
      this.roleDrafts.set({});
      this.error.set("");
      this.message.set("");
      this.forbidden.set(false);
      this.pendingRemoval.set("");
      this.transferTarget.set("");
      this.transferConfirmation.set(false);
      if (!workspaceId || this.design) {
        this.loading.set(false);
        return;
      }
      void this.loadMembers(workspaceId, version);
    });
    this.destroy.onDestroy(() => { this.requestVersion += 1; this.inviteEmail = ""; this.inviteKey = ""; });
  }

  async refresh(): Promise<void> {
    const workspaceId = this.workspaceStore.workspaceId();
    if (!workspaceId || this.design) return;
    const version = ++this.requestVersion;
    this.error.set("");
    this.message.set("");
    await this.loadMembers(workspaceId, version);
  }

  private async loadMembers(workspaceId: string, version: number): Promise<void> {
    this.loading.set(true);
    try {
      const result = await this.api.members(workspaceId);
      if (version !== this.requestVersion || workspaceId !== this.workspaceStore.workspaceId()) return;
      this.members.set(result.items);
      this.roleDrafts.set(Object.fromEntries(result.items.map((member) => [member.userId, member.role === "owner" ? "reader" : member.role])));
      this.forbidden.set(false);
    } catch (error) {
      if (version !== this.requestVersion || workspaceId !== this.workspaceStore.workspaceId()) return;
      this.forbidden.set(error instanceof HttpErrorResponse && error.status === 403);
      this.error.set(this.forbidden() ? "Tu cuenta ya no tiene acceso a este espacio. Elige otro espacio y vuelve a intentarlo." : errorMessage(error));
    } finally {
      if (version === this.requestVersion && workspaceId === this.workspaceStore.workspaceId()) this.loading.set(false);
    }
  }

  roleLabel(role: WorkspaceRole): string {
    return ({ owner: "Propietario", admin: "Administrador", editor: "Editor", reader: "Lector" })[role];
  }
  roleDraft(member: Schema<"MemberDto">): AssignableWorkspaceRole {
    return this.roleDrafts()[member.userId] ?? (member.role === "owner" ? "reader" : member.role);
  }
  setRoleDraft(userId: string, value: string): void {
    if (value === "admin" || value === "editor" || value === "reader") this.roleDrafts.update((drafts) => ({ ...drafts, [userId]: value }));
  }
  canManageMember(member: Schema<"MemberDto">): boolean {
    const actor = this.actorRole();
    return !!actor && roleCanManageMember(actor, member.role);
  }
  roleOptions(member: Schema<"MemberDto">): AssignableWorkspaceRole[] {
    return this.actorRole() === "owner" ? ["admin", "editor", "reader"] : member.role === "admin" ? [] : ["editor", "reader"];
  }
  canInviteSelected(): boolean {
    const actor = this.actorRole();
    return !!actor && roleCanInviteAs(actor, this.inviteRole);
  }
  isCurrentMember(member: Schema<"MemberDto">): boolean {
    return member.userId === this.session.user()?.id;
  }
  private isActiveWorkspace(workspaceId: string): boolean {
    return !!workspaceId && workspaceId === this.workspaceStore.workspaceId();
  }
  async createTeam(): Promise<void> {
    if (this.createBusy || !this.teamName.trim()) return;
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
    if (!workspace || !this.canManage() || !roleCanInviteAs(this.actorRole()!, this.inviteRole) || this.mutationBusy()) return;
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
      this.message.set(`Invitación enviada a ${email}. La persona debe abrir el correo e iniciar sesión con esa misma dirección para aceptar.`);
    } catch (error) { if (this.isActiveWorkspace(workspace.id)) this.error.set(errorMessage(error)); }
    finally { this.mutationBusy.set(false); }
  }
  async saveRole(member: Schema<"MemberDto">): Promise<void> {
    const workspaceId = this.workspaceStore.workspaceId();
    const role = this.roleDraft(member);
    if (!workspaceId || !this.canManageMember(member) || role === member.role || this.mutationBusy()) return;
    this.mutationBusy.set(true); this.error.set(""); this.message.set("");
    try {
      await this.api.setRole(workspaceId, member.userId, role);
      if (!this.isActiveWorkspace(workspaceId)) return;
      await this.refreshAfterMutation(workspaceId, "Rol actualizado.");
    } catch (error) { if (this.isActiveWorkspace(workspaceId)) this.error.set(errorMessage(error)); }
    finally { this.mutationBusy.set(false); }
  }
  async confirmRemove(member: Schema<"MemberDto">): Promise<void> {
    const workspaceId = this.workspaceStore.workspaceId();
    if (!workspaceId || !this.canManageMember(member) || this.pendingRemoval() !== member.userId || this.mutationBusy()) return;
    this.mutationBusy.set(true); this.error.set(""); this.message.set("");
    try {
      await this.api.remove(workspaceId, member.userId);
      if (!this.isActiveWorkspace(workspaceId)) return;
      this.pendingRemoval.set("");
      await this.refreshAfterMutation(workspaceId, this.isCurrentMember(member) ? "Tu cuenta salió del espacio." : "Miembro retirado del espacio.");
    } catch (error) { if (this.isActiveWorkspace(workspaceId)) this.error.set(errorMessage(error)); }
    finally { this.mutationBusy.set(false); }
  }
  async transferOwnership(): Promise<void> {
    const workspaceId = this.workspaceStore.workspaceId();
    const target = this.members().find((member) => member.userId === this.transferTarget());
    if (!workspaceId || !target || !this.canTransfer() || !this.transferConfirmation() || this.mutationBusy()) return;
    this.mutationBusy.set(true); this.error.set(""); this.message.set("");
    try {
      await this.api.transfer(workspaceId, target.userId);
      if (!this.isActiveWorkspace(workspaceId)) return;
      this.transferConfirmation.set(false);
      this.transferTarget.set("");
      await this.refreshAfterMutation(workspaceId, `La propiedad ahora pertenece a la cuenta ${target.userId.slice(0, 8)}.`);
    } catch (error) { if (this.isActiveWorkspace(workspaceId)) this.error.set(errorMessage(error)); }
    finally { this.mutationBusy.set(false); }
  }
  private async refreshAfterMutation(workspaceId: string, success: string): Promise<void> {
    if (!this.isActiveWorkspace(workspaceId)) return;
    await this.workspaceStore.loadWorkspaces();
    if (!this.isActiveWorkspace(workspaceId)) return;
    this.message.set(success);
    await this.refresh();
    if (this.isActiveWorkspace(workspaceId) && !this.error()) this.message.set(success);
  }
}
