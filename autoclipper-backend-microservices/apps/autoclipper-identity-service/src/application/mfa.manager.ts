import { UnauthorizedException, ConflictException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { seal, unseal, digest } from "@autoclipper/http-security";
import { newTotp, totpStep } from "../domain/totp.js";
type MfaRow = {
  secret_cipher: string | null;
  pending_cipher: string | null;
  pending_expires_at: Date | null;
  enabled: boolean;
  last_step: string;
};
export class MfaManager {
  constructor(readonly key: string) {}
  async setup(client: pg.PoolClient, userId: string, email: string) {
    const factor = newTotp(email);
    const inserted = await client.query(
      "INSERT INTO user_mfa(user_id,pending_cipher,pending_expires_at) VALUES($1,$2,now()+interval '10 minutes') ON CONFLICT(user_id) DO UPDATE SET pending_cipher=EXCLUDED.pending_cipher,pending_expires_at=EXCLUDED.pending_expires_at WHERE user_mfa.enabled=false RETURNING user_id",
      [userId, seal(factor.secret, this.key, `mfa:${userId}`)],
    );
    if (!inserted.rows.length) throw new ConflictException();
    return { otpauthUri: factor.uri, expiresInSeconds: 600 };
  }
  async enable(client: pg.PoolClient, userId: string, code: string) {
    const row = (
      await client.query<MfaRow>(
        "SELECT * FROM user_mfa WHERE user_id=$1 FOR UPDATE",
        [userId],
      )
    ).rows[0];
    if (
      !row ||
      row.enabled ||
      !row.pending_cipher ||
      !row.pending_expires_at ||
      row.pending_expires_at <= new Date()
    )
      throw new UnauthorizedException();
    const step = totpStep(
      unseal(row.pending_cipher, this.key, `mfa:${userId}`),
      code,
    );
    if (step === null) throw new UnauthorizedException();
    await client.query(
      "UPDATE user_mfa SET secret_cipher=pending_cipher,pending_cipher=NULL,pending_expires_at=NULL,enabled=true,last_step=$1 WHERE user_id=$2",
      [step, userId],
    );
    return { enabled: true, recoveryCodes: await this.codes(client, userId) };
  }
  async verify(
    client: pg.PoolClient,
    userId: string,
    factor: string | undefined,
  ) {
    const row = (
      await client.query<MfaRow>(
        "SELECT * FROM user_mfa WHERE user_id=$1 FOR UPDATE",
        [userId],
      )
    ).rows[0];
    if (!row?.enabled) return;
    if (!factor) throw new UnauthorizedException();
    if (/^\d{6}$/.test(factor)) {
      const step = row.secret_cipher
        ? totpStep(unseal(row.secret_cipher, this.key, `mfa:${userId}`), factor)
        : null;
      if (step === null || step <= Number(row.last_step))
        throw new UnauthorizedException();
      await client.query("UPDATE user_mfa SET last_step=$1 WHERE user_id=$2", [
        step,
        userId,
      ]);
      return;
    }
    const consumed = await client.query(
      "UPDATE recovery_codes SET consumed_at=now() WHERE user_id=$1 AND code_hash=$2 AND consumed_at IS NULL RETURNING code_hash",
      [userId, digest(factor)],
    );
    if (!consumed.rows.length) throw new UnauthorizedException();
  }
  async disable(
    client: pg.PoolClient,
    userId: string,
    factor: string | undefined,
  ) {
    await this.verify(client, userId, factor);
    await client.query("DELETE FROM recovery_codes WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM user_mfa WHERE user_id=$1", [userId]);
    return { enabled: false };
  }
  async codes(client: pg.PoolClient, userId: string) {
    const codes = Array.from({ length: 10 }, () =>
      randomBytes(12).toString("hex"),
    );
    await client.query("DELETE FROM recovery_codes WHERE user_id=$1", [userId]);
    for (const code of codes)
      await client.query(
        "INSERT INTO recovery_codes(user_id,code_hash) VALUES($1,$2)",
        [userId, digest(code)],
      );
    return codes;
  }
}
