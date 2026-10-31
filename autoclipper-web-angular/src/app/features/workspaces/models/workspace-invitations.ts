export type WorkspaceInvitation = {
  id: string;
  email: string;
  role: "admin" | "editor" | "reader";
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};

export type WorkspaceInvitationStatus = "pending" | "accepted" | "expired" | "revoked";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value)));
}

/** Validate the actual snake_case response returned by the workspace service. */
export function parseWorkspaceInvitations(value: unknown): WorkspaceInvitation[] {
  if (!isRecord(value) || !Array.isArray(value["items"]) || value["items"].length > 100) {
    throw new Error("El servidor devolvió un listado de invitaciones con formato inesperado.");
  }
  return value["items"].map((item): WorkspaceInvitation => {
    if (!isRecord(item)) throw new Error("El servidor devolvió un listado de invitaciones con formato inesperado.");
    const { id, email, role, expires_at: expiresAt, accepted_at: acceptedAt, revoked_at: revokedAt } = item;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      || typeof email !== "string" || email.length > 254
      || (role !== "admin" && role !== "editor" && role !== "reader")
      || typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))
      || !isTimestamp(acceptedAt) || !isTimestamp(revokedAt)) {
      throw new Error("El servidor devolvió un listado de invitaciones con formato inesperado.");
    }
    return { id, email, role, expiresAt, acceptedAt, revokedAt };
  });
}

export function workspaceInvitationStatus(invitation: WorkspaceInvitation, now = Date.now()): WorkspaceInvitationStatus {
  if (invitation.revokedAt) return "revoked";
  if (invitation.acceptedAt) return "accepted";
  return Date.parse(invitation.expiresAt) <= now ? "expired" : "pending";
}
