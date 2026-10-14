import {
  Injectable,
  UnauthorizedException,
  HttpException,
  ConflictException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { Request, Response } from "express";
import pg from "pg";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { z } from "zod";
import {
  loadServiceConfig,
  digest,
  opaqueToken,
  cookie,
  setCookie,
  clearCookies,
  same,
  body,
  requireCsrf,
  requireInternal,
} from "@autoclipper/http-security";
import { logger } from "@autoclipper/observability";
import {
  registration,
  login,
  token,
  resetRequest,
  reset,
  type PublicUser,
} from "../domain/credentials.js";
import { mailTransport, seal, unseal } from "../infrastructure/mail.js";
import { MfaManager } from "./mfa.manager.js";

type UserRow = PublicUser & { password_hash: string; verified_at: Date | null };
type SessionRow = {
  id: string;
  user_id: string;
  refresh_hash: string;
  consumed_at: Date | null;
  revoked_at: Date | null;
  expires_at: Date;
};
@Injectable()
export class IdentityService implements OnModuleInit, OnModuleDestroy {
  readonly config = loadServiceConfig();
  readonly pool = new pg.Pool({
    connectionString: this.config.DATABASE_URL,
    max: 8,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
  });
  readonly redis = new Redis(process.env["REDIS_URL"] ?? "", {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2000,
  });
  readonly transport = mailTransport();
  readonly encryptionKey = process.env["AUTH_ENCRYPTION_KEY"] ?? "";
  readonly mfa = new MfaManager(this.encryptionKey);
  private dummyHash = "";
  private timer: NodeJS.Timeout | undefined;
  private sending: Promise<void> | undefined;
  async onModuleInit() {
    if (!/^[0-9a-f]{64}$/.test(this.encryptionKey))
      throw new Error("AUTH_ENCRYPTION_KEY invalid");
    this.pool.on("error", () =>
      logger.error({ code: "IDENTITY_DATABASE_ERROR" }),
    );
    this.redis.on("error", () =>
      logger.error({ code: "IDENTITY_RATE_LIMIT_UNAVAILABLE" }),
    );
    this.dummyHash = await this.hash(opaqueToken());
    this.timer = setInterval(() => {
      if (!this.sending)
        this.sending = this.deliver()
          .catch(() => logger.error({ code: "MAIL_DELIVERY_FAILED" }))
          .finally(() => {
            this.sending = undefined;
          });
    }, 1000);
    this.timer.unref();
  }
  private hash(value: string) {
    return argon2.hash(value, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }
  private async tx<T>(work: (client: pg.PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async limit(req: Request, subject: string) {
    const trusted = req.headers["x-service-token"];
    const forwarded = req.headers["x-client-ip"];
    const remote =
      typeof trusted === "string" &&
      same(trusted, this.config.INTERNAL_TOKEN) &&
      typeof forwarded === "string"
        ? forwarded
        : req.ip;
    const script =
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],600) end; return n";
    const total = Number(
      await this.redis.eval(
        script,
        1,
        `identity:global:${digest(remote ?? "unknown")}`,
      ),
    );
    if (total > 120) throw new HttpException("Rate limited", 429);
    const key = `identity:rate:${digest(`${remote}:${subject}`)}`;
    const count = Number(
      await this.redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],600) end; return n",
        1,
        key,
      ),
    );
    if (count > 20) throw new HttpException("Rate limited", 429);
  }
  private async mail(
    client: pg.PoolClient,
    user: PublicUser,
    purpose: "verify" | "reset",
  ) {
    const raw = opaqueToken();
    const id = randomUUID();
    await client.query(
      "INSERT INTO verification_tokens(id,user_id,token_hash,purpose,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')",
      [id, user.id, digest(raw), purpose],
    );
    const payload = {
      to: user.email,
      subject:
        purpose === "verify"
          ? "Verifica tu cuenta AutoClipper"
          : "Recupera tu cuenta AutoClipper",
      text: `${this.config.CORS_ORIGIN}/auth/${purpose}?token=${raw}\nEste enlace vence en 30 minutos. Si no solicitaste esta acción, ignora este mensaje.`,
    };
    await client.query("INSERT INTO mail_outbox(id,payload) VALUES($1,$2)", [
      id,
      seal(JSON.stringify(payload), this.encryptionKey),
    ]);
  }
  async register(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(registration, input);
    await this.limit(req, data.email);
    const hash = await this.hash(data.password);
    await this.tx(async (client) => {
      const result = await client.query<UserRow>(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING *",
        [randomUUID(), data.email, data.name, hash],
      );
      if (result.rows[0]) await this.mail(client, result.rows[0], "verify");
    });
    return { accepted: true };
  }
  async verify(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(token, input);
    await this.limit(req, "verify");
    return this.tx(async (client) => {
      const result = await client.query<{ id: string; user_id: string }>(
        "UPDATE verification_tokens SET consumed_at=now() WHERE token_hash=$1 AND purpose='verify' AND consumed_at IS NULL AND expires_at>now() RETURNING id,user_id",
        [digest(data.token)],
      );
      const row = result.rows[0];
      if (!row) throw new UnauthorizedException();
      await client.query(
        "UPDATE users SET verified_at=COALESCE(verified_at,now()) WHERE id=$1",
        [row.user_id],
      );
      return { verified: true };
    });
  }
  async signIn(req: Request, res: Response, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(login, input);
    await this.limit(req, data.email);
    const result = await this.pool.query<UserRow>(
      "SELECT * FROM users WHERE email=$1",
      [data.email],
    );
    const user = result.rows[0];
    const matches = await argon2.verify(
      user?.password_hash ?? this.dummyHash,
      data.password,
    );
    if (!user || !matches || !user.verified_at)
      throw new UnauthorizedException();
    const access = opaqueToken(),
      refresh = opaqueToken(),
      session = randomUUID();
    await this.tx(async (client) => {
      const locked = (
        await client.query<{ password_hash: string }>(
          "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
          [user.id],
        )
      ).rows[0];
      if (!locked || locked.password_hash !== user.password_hash)
        throw new UnauthorizedException();
      await this.mfa.verify(client, user.id, data.factor);
      await client.query(
        "INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
        [session, user.id],
      );
      await client.query(
        "INSERT INTO refresh_tokens(token_hash,session_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
        [digest(refresh), session],
      );
      await client.query(
        "INSERT INTO access_tokens(token_hash,session_id,expires_at) VALUES($1,$2,now()+interval '15 minutes')",
        [digest(access), session],
      );
      await this.audit(client, user.id, "session.login", req);
    });
    setCookie(res, "access", access, 900000);
    setCookie(res, "refresh", refresh, 2592000000);
    return { user: { id: user.id, email: user.email, name: user.name } };
  }
  async authenticate(raw: string): Promise<PublicUser> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new UnauthorizedException();
    const result = await this.pool.query<PublicUser>(
      "SELECT u.id,u.email,u.name FROM access_tokens a JOIN sessions s ON s.id=a.session_id JOIN users u ON u.id=s.user_id WHERE a.token_hash=$1 AND a.expires_at>now() AND s.expires_at>now() AND s.revoked_at IS NULL",
      [digest(raw)],
    );
    const user = result.rows[0];
    if (!user) throw new UnauthorizedException();
    return user;
  }
  async me(req: Request) {
    return this.authenticate(cookie(req, "access"));
  }
  private async sensitive<T>(
    req: Request,
    password: string,
    work: (client: pg.PoolClient, user: PublicUser) => Promise<T>,
  ) {
    const user = await this.me(req);
    await this.limit(req, `sensitive:${user.id}`);
    const current = (
      await this.pool.query<UserRow>("SELECT * FROM users WHERE id=$1", [
        user.id,
      ])
    ).rows[0];
    if (!current || !(await argon2.verify(current.password_hash, password)))
      throw new UnauthorizedException();
    return this.tx(async (client) => {
      const locked = (
        await client.query<{ password_hash: string }>(
          "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
          [user.id],
        )
      ).rows[0];
      if (!locked || locked.password_hash !== current.password_hash)
        throw new UnauthorizedException();
      return work(client, user);
    });
  }
  async mfaStatus(req: Request) {
    const user = await this.me(req);
    const row = (
      await this.pool.query<{ enabled: boolean }>(
        "SELECT enabled FROM user_mfa WHERE user_id=$1",
        [user.id],
      )
    ).rows[0];
    const codes = (
      await this.pool.query<{ count: string }>(
        "SELECT count(*) FROM recovery_codes WHERE user_id=$1 AND consumed_at IS NULL",
        [user.id],
      )
    ).rows[0];
    return {
      enabled: row?.enabled ?? false,
      recoveryCodesRemaining: Number(codes?.count ?? 0),
    };
  }
  async setupMfa(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(
      z.object({ password: z.string().min(1).max(128) }).strict(),
      input,
    );
    return this.sensitive(req, data.password, async (client, user) => {
      const result = await this.mfa.setup(client, user.id, user.email);
      await this.audit(client, user.id, "mfa.setup", req);
      return result;
    });
  }
  async enableMfa(req: Request, res: Response, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(
      z
        .object({
          password: z.string().min(1).max(128),
          code: z.string().regex(/^\d{6}$/),
        })
        .strict(),
      input,
    );
    const result = await this.sensitive(
      req,
      data.password,
      async (client, user) => {
        const enabled = await this.mfa.enable(client, user.id, data.code);
        await client.query(
          "UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1",
          [user.id],
        );
        await this.audit(client, user.id, "mfa.enabled", req);
        return enabled;
      },
    );
    clearCookies(res);
    return result;
  }
  async disableMfa(req: Request, res: Response, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(
      z
        .object({
          password: z.string().min(1).max(128),
          factor: z
            .string()
            .regex(/^(\d{6}|[a-f0-9]{24})$/)
            .optional(),
        })
        .strict(),
      input,
    );
    const result = await this.sensitive(
      req,
      data.password,
      async (client, user) => {
        const disabled = await this.mfa.disable(client, user.id, data.factor);
        await client.query(
          "UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1",
          [user.id],
        );
        await this.audit(client, user.id, "mfa.disabled", req);
        return disabled;
      },
    );
    clearCookies(res);
    return result;
  }
  async rotateRecovery(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(
      z
        .object({
          password: z.string().min(1).max(128),
          factor: z.string().regex(/^(\d{6}|[a-f0-9]{24})$/),
        })
        .strict(),
      input,
    );
    return this.sensitive(req, data.password, async (client, user) => {
      const active = (
        await client.query<{ enabled: boolean }>(
          "SELECT enabled FROM user_mfa WHERE user_id=$1",
          [user.id],
        )
      ).rows[0];
      if (!active?.enabled) throw new ConflictException();
      await this.mfa.verify(client, user.id, data.factor);
      const recoveryCodes = await this.mfa.codes(client, user.id);
      await this.audit(client, user.id, "mfa.recovery_rotated", req);
      return { recoveryCodes };
    });
  }
  async profile(req: Request) {
    const user = await this.me(req);
    const row = (
      await this.pool.query<{
        name: string;
        preferences: Record<string, unknown>;
        profile_version: number;
      }>("SELECT name,preferences,profile_version FROM users WHERE id=$1", [
        user.id,
      ])
    ).rows[0]!;
    return {
      id: user.id,
      email: user.email,
      name: row.name,
      preferences: row.preferences,
      version: row.profile_version,
    };
  }
  async updateProfile(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const user = await this.me(req);
    const preferences = z
      .object({
        locale: z.enum(["es", "en"]).optional(),
        timezone: z
          .string()
          .max(64)
          .refine(
            (value) =>
              value === "UTC" ||
              Intl.supportedValuesOf("timeZone").includes(value),
          )
          .optional(),
        emailNotifications: z.boolean().optional(),
        theme: z.enum(["light", "dark", "system"]).optional(),
      })
      .strict();
    const data = body(
      z
        .object({
          name: z.string().trim().min(1).max(100).optional(),
          preferences: preferences.optional(),
          version: z.number().int().positive(),
        })
        .strict()
        .refine(
          (value) =>
            value.name !== undefined ||
            Object.keys(value.preferences ?? {}).length > 0,
        ),
      input,
    );
    const updated = await this.pool.query<{ profile_version: number }>(
      "UPDATE users SET name=COALESCE($1,name),preferences=preferences||$2::jsonb,profile_version=profile_version+1 WHERE id=$3 AND profile_version=$4 RETURNING profile_version",
      [
        data.name ?? null,
        JSON.stringify(data.preferences ?? {}),
        user.id,
        data.version,
      ],
    );
    if (!updated.rows[0]) throw new ConflictException();
    return { version: updated.rows[0].profile_version };
  }
  async privacy(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(
      z
        .object({
          kind: z.enum(["export", "deletion"]),
          password: z.string().min(1).max(128),
          factor: z
            .string()
            .regex(/^(\d{6}|[a-f0-9]{24})$/)
            .optional(),
        })
        .strict(),
      input,
    );
    return this.sensitive(req, data.password, async (client, user) => {
      await this.mfa.verify(client, user.id, data.factor);
      const inserted = await client.query<{ id: string }>(
        "INSERT INTO privacy_requests(id,user_id,kind) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id",
        [randomUUID(), user.id, data.kind],
      );
      const row =
        inserted.rows[0] ??
        (
          await client.query<{ id: string }>(
            "SELECT id FROM privacy_requests WHERE user_id=$1 AND kind=$2 AND state='requested'",
            [user.id, data.kind],
          )
        ).rows[0]!;
      if (inserted.rows[0])
        await this.audit(
          client,
          user.id,
          `privacy.${data.kind}_requested`,
          req,
        );
      return {
        id: row.id,
        kind: data.kind,
        state: "requested",
        fulfillment: "pending",
      };
    });
  }
  async privacyRequests(req: Request) {
    const user = await this.me(req);
    return {
      items: (
        await this.pool.query(
          "SELECT id,kind,state,created_at,completed_at FROM privacy_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
          [user.id],
        )
      ).rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        state: row.state,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      })),
    };
  }
  async internal(req: Request, input: unknown) {
    requireInternal(req, this.config);
    const data = body(token, input);
    return this.authenticate(data.token);
  }
  async sendInvitation(req: Request, input: unknown) {
    requireInternal(req, this.config);
    const data = body(
      z
        .object({
          deliveryId: z.uuid(),
          to: z.email().max(254),
          workspaceName: z.string().max(100),
          token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        })
        .strict(),
      input,
    );
    const payload = {
      to: data.to,
      subject: "Invitación a un equipo de AutoClipper",
      text: `Has sido invitado al equipo ${data.workspaceName}.\n${this.config.CORS_ORIGIN}/auth/invitation?token=${data.token}\nLa invitación vence en siete días.`,
    };
    await this.pool.query(
      "INSERT INTO mail_outbox(id,payload) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
      [data.deliveryId, seal(JSON.stringify(payload), this.encryptionKey)],
    );
    return { accepted: true };
  }
  async refresh(req: Request, res: Response) {
    requireCsrf(req, this.config);
    await this.limit(req, "refresh");
    const raw = cookie(req, "refresh");
    const next = opaqueToken(),
      access = opaqueToken();
    const outcome = await this.tx(async (client) => {
      const result = await client.query<SessionRow>(
        "SELECT s.id,s.user_id,s.revoked_at,s.expires_at,r.token_hash AS refresh_hash,r.consumed_at FROM refresh_tokens r JOIN sessions s ON s.id=r.session_id WHERE r.token_hash=$1 AND r.expires_at>now() FOR UPDATE OF s,r",
        [digest(raw)],
      );
      const row = result.rows[0];
      if (!row || row.revoked_at || row.expires_at <= new Date()) return false;
      if (row.consumed_at) {
        await client.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [
          row.id,
        ]);
        await this.audit(client, row.user_id, "session.refresh_reuse", req);
        return false;
      }
      await client.query(
        "UPDATE refresh_tokens SET consumed_at=now() WHERE token_hash=$1",
        [digest(raw)],
      );
      await client.query(
        "INSERT INTO refresh_tokens(token_hash,session_id,expires_at) VALUES($1,$2,$3)",
        [digest(next), row.id, row.expires_at],
      );
      await client.query(
        "INSERT INTO access_tokens(token_hash,session_id,expires_at) VALUES($1,$2,now()+interval '15 minutes')",
        [digest(access), row.id],
      );
      return true;
    });
    if (!outcome) {
      clearCookies(res);
      throw new UnauthorizedException();
    }
    setCookie(res, "access", access, 900000);
    setCookie(res, "refresh", next, 2592000000);
    return { renewed: true };
  }
  async logout(req: Request, res: Response) {
    requireCsrf(req, this.config);
    await this.pool.query(
      "UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id IN (SELECT session_id FROM refresh_tokens WHERE token_hash=$1 UNION SELECT session_id FROM access_tokens WHERE token_hash=$2)",
      [digest(cookie(req, "refresh")), digest(cookie(req, "access"))],
    );
    clearCookies(res);
    return { revoked: true };
  }
  async sessions(req: Request) {
    const user = await this.me(req);
    const result = await this.pool.query(
      "SELECT id,created_at,expires_at,revoked_at FROM sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
      [user.id],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
      })),
    };
  }
  async revoke(req: Request, id: string) {
    requireCsrf(req, this.config);
    const user = await this.me(req);
    await this.pool.query(
      "UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND user_id=$2",
      [id, user.id],
    );
    return { revoked: true };
  }
  async requestReset(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(resetRequest, input);
    await this.limit(req, data.email);
    await this.tx(async (client) => {
      const result = await client.query<UserRow>(
        "SELECT * FROM users WHERE email=$1 AND verified_at IS NOT NULL",
        [data.email],
      );
      if (result.rows[0]) await this.mail(client, result.rows[0], "reset");
    });
    return { accepted: true };
  }
  async resetPassword(req: Request, res: Response, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(reset, input);
    await this.limit(req, "reset");
    const hash = await this.hash(data.password);
    await this.tx(async (client) => {
      const result = await client.query<{ user_id: string }>(
        "UPDATE verification_tokens SET consumed_at=now() WHERE token_hash=$1 AND purpose='reset' AND consumed_at IS NULL AND expires_at>now() RETURNING user_id",
        [digest(data.token)],
      );
      const row = result.rows[0];
      if (!row) throw new UnauthorizedException();
      await client.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
        hash,
        row.user_id,
      ]);
      await client.query(
        "UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1",
        [row.user_id],
      );
      await client.query(
        "UPDATE verification_tokens SET consumed_at=COALESCE(consumed_at,now()) WHERE user_id=$1 AND purpose='reset'",
        [row.user_id],
      );
      await this.audit(client, row.user_id, "password.reset", req);
    });
    clearCookies(res);
    return { reset: true };
  }
  private async deliver() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string; payload: string }>(
        "SELECT id,payload FROM mail_outbox WHERE delivered_at IS NULL AND attempts<5 AND next_attempt_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      );
      const row = result.rows[0];
      if (row) {
        try {
          const payload = JSON.parse(
            unseal(row.payload, this.encryptionKey),
          ) as { to: string; subject: string; text: string };
          await this.transport.sendMail({
            from:
              process.env["SMTP_FROM"] ??
              "AutoClipper <no-reply@autoclipper.test>",
            ...payload,
          });
          await client.query(
            "UPDATE mail_outbox SET delivered_at=now(),payload='delivered' WHERE id=$1",
            [row.id],
          );
        } catch {
          await client.query(
            "UPDATE mail_outbox SET attempts=attempts+1,next_attempt_at=now()+interval '10 seconds' * power(2,attempts) WHERE id=$1",
            [row.id],
          );
          logger.warn({ code: "MAIL_RETRY", messageId: row.id });
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.sending;
    this.transport.close();
    this.redis.disconnect();
    await this.pool.end();
  }
  private async audit(
    client: pg.PoolClient,
    userId: string,
    action: string,
    req: Request,
  ) {
    await client.query(
      "INSERT INTO security_audit(id,user_id,action,correlation_id) VALUES($1,$2,$3,$4)",
      [
        randomUUID(),
        userId,
        action,
        String(req.res?.locals["correlationId"] ?? randomUUID()),
      ],
    );
  }
  async securityEvents(req: Request) {
    const user = await this.me(req);
    return {
      items: (
        await this.pool.query(
          "SELECT id,action,correlation_id,created_at FROM security_audit WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
          [user.id],
        )
      ).rows.map((row) => ({
        id: row.id,
        action: row.action,
        correlationId: row.correlation_id,
        createdAt: row.created_at,
      })),
    };
  }
}
