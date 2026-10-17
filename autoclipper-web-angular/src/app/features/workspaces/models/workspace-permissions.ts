export type WorkspaceRole = "owner" | "admin" | "editor" | "reader";
export type AssignableWorkspaceRole = Exclude<WorkspaceRole, "owner">;

const weight: Record<WorkspaceRole, number> = { reader: 0, editor: 1, admin: 2, owner: 3 };

export function hasWorkspaceLevel(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return weight[role] >= weight[minimum];
}

export function canManageWorkspace(role: WorkspaceRole): boolean {
  return hasWorkspaceLevel(role, "admin");
}

export function canInviteAs(actor: WorkspaceRole, invited: AssignableWorkspaceRole): boolean {
  return canManageWorkspace(actor) && (invited !== "admin" || actor === "owner");
}

export function canManageMember(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  return canManageWorkspace(actor) && target !== "owner" && (actor === "owner" || target !== "admin");
}

export function canTransferOwnership(actor: WorkspaceRole, workspaceKind: "personal" | "team"): boolean {
  return actor === "owner" && workspaceKind === "team";
}
