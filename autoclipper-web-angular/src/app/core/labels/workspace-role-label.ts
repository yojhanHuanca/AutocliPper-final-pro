export function workspaceRoleLabel(role: string): string {
  return ({ owner: "Propietario", admin: "Administrador", editor: "Editor", reader: "Lector" } as Record<string, string>)[role] ?? "Cuenta";
}
