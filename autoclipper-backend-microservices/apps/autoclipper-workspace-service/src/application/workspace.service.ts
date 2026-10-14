import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { Request } from "express";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  authenticatedUser,
  loadServiceConfig,
  requireCsrf,
  requireInternal,
  body,
  digest,
  uuid,
  opaqueToken,
  seal,
  unseal,
  internalJson,
} from "@autoclipper/http-security";
import { permits, type Role } from "../domain/permissions.js";
import { logger } from "@autoclipper/observability";

@Injectable()
export class WorkspaceService implements OnModuleInit, OnModuleDestroy {
  readonly config = loadServiceConfig();
  readonly pool = new pg.Pool({
    connectionString: this.config.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
  });
  private async tx<T>(work: (c: pg.PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const result = await work(c);
      await c.query("COMMIT");
      return result;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
  private timer: NodeJS.Timeout | undefined;
  private sending: Promise<void> | undefined;
  readonly encryptionKey = process.env["AUTH_ENCRYPTION_KEY"] ?? "";
  onModuleInit() {
    if (!/^[0-9a-f]{64}$/.test(this.encryptionKey))
      throw new Error("AUTH_ENCRYPTION_KEY invalid");
    this.pool.on("error", () =>
      logger.error({ code: "WORKSPACE_DATABASE_ERROR" }),
    );
    this.timer = setInterval(() => {
      if (!this.sending)
        this.sending = this.deliverInvitations()
          .catch(() => logger.warn({ code: "INVITATION_DELIVERY_RETRY" }))
          .finally(() => {
            this.sending = undefined;
          });
    }, 1000);
    this.timer.unref();
  }
  async authorize(
    userId: string,
    workspaceId: string,
    minimum: Role = "reader",
    client: pg.Pool | pg.PoolClient = this.pool,
  ) {
    const result = await client.query<{ role: Role }>(
      "SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2",
      [workspaceId, userId],
    );
    const row = result.rows[0];
    if (!row || !permits(row.role, minimum)) throw new ForbiddenException();
    return row;
  }
  async internal(req: Request, input: unknown) {
    requireInternal(req, this.config);
    const data = body(
      z
        .object({
          userId: z.uuid(),
          workspaceId: z.uuid(),
          minimum: z.enum(["reader", "editor", "admin", "owner"]),
        })
        .strict(),
      input,
    );
    return this.authorize(data.userId, data.workspaceId, data.minimum);
  }
  async list(req: Request) {
    const user = await authenticatedUser(req, this.config);
    const result = await this.pool.query(
      "SELECT w.id,w.name,w.kind,m.role,w.created_at FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.created_at DESC LIMIT 100",
      [user.id],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        role: row.role,
        createdAt: row.created_at,
      })),
    };
  }
  async create(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const user = await authenticatedUser(req, this.config);
    const data = body(
      z
        .object({
          name: z.string().trim().min(1).max(100),
          kind: z.enum(["personal", "team"]).default("personal"),
        })
        .strict(),
      input,
    );
    const key = uuid(String(req.headers["idempotency-key"] ?? ""));
    const hash = digest(JSON.stringify(data));
    return this.tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        user.id,
      ]);
      const prior = await c.query<{ id: string; request_hash: string }>(
        "SELECT id,request_hash FROM workspaces WHERE creator_id=$1 AND idempotency_key=$2",
        [user.id, key],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== hash) throw new ConflictException();
        return { id: prior.rows[0].id };
      }
      if (data.kind === "personal") {
        const own = await c.query<{ id: string }>(
          "SELECT id FROM workspaces WHERE creator_id=$1 AND kind='personal'",
          [user.id],
        );
        if (own.rows[0]) return { id: own.rows[0].id };
      }
      const count = await c.query<{ count: string }>(
        "SELECT count(*) FROM memberships WHERE user_id=$1",
        [user.id],
      );
      if (Number(count.rows[0]?.count) > 99) throw new ConflictException();
      const id = randomUUID();
      await c.query(
        "INSERT INTO workspaces(id,creator_id,name,kind,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [id, user.id, data.name, data.kind, key, hash],
      );
      await c.query(
        "INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')",
        [id, user.id],
      );
      await c.query(
        "INSERT INTO workspace_audit(id,workspace_id,actor_id,action) VALUES($1,$2,$3,'workspace.created')",
        [randomUUID(), id, user.id],
      );
      return { id };
    });
  }
  async members(req: Request, id: string) {
    const user = await authenticatedUser(req, this.config);
    await this.authorize(user.id, id);
    return {
      items: (
        await this.pool.query(
          "SELECT user_id,role,created_at FROM memberships WHERE workspace_id=$1 ORDER BY created_at LIMIT 100",
          [id],
        )
      ).rows.map((row) => ({
        userId: row.user_id,
        role: row.role,
        createdAt: row.created_at,
      })),
    };
  }
  async setRole(req: Request, id: string, member: string, input: unknown) {
    requireCsrf(req, this.config);
    const user = await authenticatedUser(req, this.config);
    const data = body(
      z.object({ role: z.enum(["admin", "editor", "reader"]) }).strict(),
      input,
    );
    return this.tx(async (c) => {
      await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [id]);
      const actor = await this.authorize(user.id, id, "admin", c);
      const target = await this.authorize(member, id, "reader", c);
      if (
        target.role === "owner" ||
        (actor.role !== "owner" &&
          (target.role === "admin" || data.role === "admin"))
      )
        throw new ForbiddenException();
      await c.query(
        "UPDATE memberships SET role=$1 WHERE workspace_id=$2 AND user_id=$3",
        [data.role, id, member],
      );
      await c.query(
        "INSERT INTO workspace_audit(id,workspace_id,actor_id,action,subject_id) VALUES($1,$2,$3,'membership.role_changed',$4)",
        [randomUUID(), id, user.id, member],
      );
      return { updated: true };
    });
  }
  async remove(req: Request, id: string, member: string) {
    requireCsrf(req, this.config);
    const user = await authenticatedUser(req, this.config);
    return this.tx(async (c) => {
      await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [id]);
      const actor = await this.authorize(user.id, id, "admin", c);
      const target = await this.authorize(member, id, "reader", c);
      if (
        target.role === "owner" ||
        (actor.role !== "owner" && target.role === "admin")
      )
        throw new ForbiddenException();
      await c.query(
        "DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2",
        [id, member],
      );
      await c.query(
        "INSERT INTO workspace_audit(id,workspace_id,actor_id,action,subject_id) VALUES($1,$2,$3,'membership.removed',$4)",
        [randomUUID(), id, user.id, member],
      );
      return { removed: true };
    });
  }
  async transfer(req: Request, id: string, input: unknown) {
    requireCsrf(req, this.config);
    const user = await authenticatedUser(req, this.config);
    const data = body(z.object({ userId: z.uuid() }).strict(), input);
    return this.tx(async (c) => {
      const workspace = await c.query<{ kind: string }>(
        "SELECT kind FROM workspaces WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!workspace.rows[0]) throw new NotFoundException();
      if (workspace.rows[0].kind === "personal") throw new ConflictException();
      await this.authorize(user.id, id, "owner", c);
      if (user.id === data.userId) return { transferred: true };
      await this.authorize(data.userId, id, "reader", c);
      await c.query(
        "UPDATE memberships SET role='admin' WHERE workspace_id=$1 AND user_id=$2",
        [id, user.id],
      );
      await c.query(
        "UPDATE memberships SET role='owner' WHERE workspace_id=$1 AND user_id=$2",
        [id, data.userId],
      );
      await c.query(
        "INSERT INTO workspace_audit(id,workspace_id,actor_id,action,subject_id) VALUES($1,$2,$3,'ownership.transferred',$4)",
        [randomUUID(), id, user.id, data.userId],
      );
      return { transferred: true };
    });
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.sending;
    await this.pool.end();
  }
  async invite(req: Request, id: string, input: unknown) {
    requireCsrf(req, this.config);
    const user = await authenticatedUser(req, this.config);
    const data = body(
      z
        .object({
          email: z
            .email()
            .max(254)
            .transform((s) => s.toLowerCase()),
          role: z.enum(["admin", "editor", "reader"]),
        })
        .strict(),
      input,
    );
    const key = uuid(String(req.headers["idempotency-key"] ?? ""));
    const hash = digest(JSON.stringify(data));
    return this.tx(async (c) => {
      const workspace = (
        await c.query<{ kind: string; name: string }>(
          "SELECT kind,name FROM workspaces WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!workspace) throw new NotFoundException();
      if (workspace.kind !== "team") throw new ConflictException();
      const actor = await this.authorize(user.id, id, "admin", c);
      if (data.role === "admin" && actor.role !== "owner")
        throw new ForbiddenException();
      const prior = (
        await c.query<{ id: string; request_hash: string }>(
          "SELECT id,request_hash FROM invitations WHERE workspace_id=$1 AND idempotency_key=$2",
          [id, key],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== hash) throw new ConflictException();
        return { id: prior.id };
      }
      const pending = await c.query<{ count: string }>(
        "SELECT count(*) FROM invitations WHERE workspace_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()",
        [id],
      );
      if (Number(pending.rows[0]?.count) >= 100) throw new ConflictException();
      const invitationId = randomUUID(),
        raw = opaqueToken();
      await c.query(
        "INSERT INTO invitations(id,workspace_id,email,role,token_hash,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [invitationId, id, data.email, data.role, digest(raw), key, hash],
      );
      await c.query("INSERT INTO invitation_outbox(id,payload) VALUES($1,$2)", [
        invitationId,
        seal(
          JSON.stringify({
            deliveryId: invitationId,
            to: data.email,
            workspaceName: workspace.name,
            token: raw,
          }),
          this.encryptionKey,
        ),
      ]);
      return { id: invitationId };
    });
  }
  async acceptInvitation(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const user = await authenticatedUser(req, this.config);
    const data = body(
      z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict(),
      input,
    );
    return this.tx(async (c) => {
      const reference = (
        await c.query<{ workspace_id: string }>(
          "SELECT workspace_id FROM invitations WHERE token_hash=$1",
          [digest(data.token)],
        )
      ).rows[0];
      if (!reference) throw new NotFoundException();
      await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
        reference.workspace_id,
      ]);
      const invite = (
        await c.query<{
          id: string;
          workspace_id: string;
          email: string;
          role: Role;
          accepted_at: Date | null;
          revoked_at: Date | null;
          expires_at: Date;
        }>("SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE", [
          digest(data.token),
        ])
      ).rows[0];
      if (
        !invite ||
        invite.email !== user.email ||
        invite.revoked_at ||
        invite.expires_at <= new Date()
      )
        throw new ForbiddenException();
      if (invite.accepted_at) return { workspaceId: invite.workspace_id };
      const count = (
        await c.query<{ count: string }>(
          "SELECT count(*) FROM memberships WHERE workspace_id=$1",
          [invite.workspace_id],
        )
      ).rows[0];
      if (Number(count?.count) >= 100) throw new ConflictException();
      await c.query(
        "INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [invite.workspace_id, user.id, invite.role],
      );
      await c.query("UPDATE invitations SET accepted_at=now() WHERE id=$1", [
        invite.id,
      ]);
      await c.query(
        "INSERT INTO workspace_audit(id,workspace_id,actor_id,action) VALUES($1,$2,$3,'invitation.accepted')",
        [randomUUID(), invite.workspace_id, user.id],
      );
      return { workspaceId: invite.workspace_id };
    });
  }
  async invitations(req: Request, id: string) {
    const user = await authenticatedUser(req, this.config);
    await this.authorize(user.id, id, "admin");
    return {
      items: (
        await this.pool.query(
          "SELECT id,email,role,expires_at,accepted_at,revoked_at FROM invitations WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100",
          [id],
        )
      ).rows,
    };
  }
  async revokeInvitation(req: Request, id: string, invitation: string) {
    requireCsrf(req, this.config);
    const user = await authenticatedUser(req, this.config);
    await this.authorize(user.id, id, "admin");
    await this.pool.query(
      "UPDATE invitations SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND workspace_id=$2",
      [invitation, id],
    );
    return { revoked: true };
  }
  private async deliverInvitations() {
    const result = await this.pool.query<{ id: string; payload: string }>(
      "SELECT id,payload FROM invitation_outbox WHERE delivered_at IS NULL AND attempts<5 AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 10",
    );
    for (const row of result.rows) {
      try {
        await internalJson(
          this.config.IDENTITY_URL,
          "/v1/internal/send-invitation",
          this.config,
          JSON.parse(unseal(row.payload, this.encryptionKey)) as unknown,
        );
        await this.pool.query(
          "UPDATE invitation_outbox SET delivered_at=now(),payload='delivered' WHERE id=$1",
          [row.id],
        );
      } catch {
        await this.pool.query(
          "UPDATE invitation_outbox SET attempts=attempts+1,next_attempt_at=now()+interval '10 seconds' * power(2,attempts) WHERE id=$1",
          [row.id],
        );
      }
    }
  }
}
