import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
async function connection(name) {
  let url = process.env[`${name.toUpperCase()}_DATABASE_URL`];
  if (!url) {
    const text = await readFile(
      new URL(`../../.env.${name}`, import.meta.url),
      "utf8",
    );
    url = text
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="))
      ?.slice(13);
  }
  assert.ok(url, `${name} runtime database required`);
  return new pg.Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
}
test("business services cannot write schemas or connect to another service database", async () => {
  for (const name of ["identity", "workspace", "project", "analysis"]) {
    const pool = await connection(name);
    try {
      await assert.rejects(
        pool.query("CREATE TABLE forbidden_fixture(id integer)"),
        (error) => error.code === "42501",
      );
      const url = new URL(pool.options.connectionString);
      url.pathname = `/autoclipper_${name === "identity" ? "workspace" : "identity"}`;
      const other = new pg.Pool({
        connectionString: url.href,
        connectionTimeoutMillis: 3000,
      });
      try {
        await assert.rejects(
          other.query("SELECT 1"),
          (error) => error.code === "42501",
        );
      } finally {
        await other.end();
      }
    } finally {
      await pool.end();
    }
  }
});
test("database rejects a workspace without an owner and deleting its last owner", async () => {
  const pool = await connection("workspace");
  const id = randomUUID(),
    creator = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO workspaces(id,creator_id,name,kind,idempotency_key,request_hash) VALUES($1,$2,'Ownership invariant fixture','team',$3,'fixture')",
      [id, creator, randomUUID()],
    );
    await assert.rejects(
      client.query("COMMIT"),
      (error) => error.code === "23514",
    );
    await client.query("ROLLBACK");
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO workspaces(id,creator_id,name,kind,idempotency_key,request_hash) VALUES($1,$2,'Ownership invariant fixture','team',$3,'fixture')",
      [id, creator, randomUUID()],
    );
    await client.query(
      "INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')",
      [id, creator],
    );
    await client.query("COMMIT");
    await client.query("BEGIN");
    await client.query("DELETE FROM memberships WHERE workspace_id=$1", [id]);
    await assert.rejects(
      client.query("COMMIT"),
      (error) => error.code === "23514",
    );
    await client.query("ROLLBACK");
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM memberships WHERE workspace_id=$1 AND role='owner'",
          [id],
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await client.query("ROLLBACK");
    await client.query("DELETE FROM workspaces WHERE id=$1", [id]);
    client.release();
    await pool.end();
  }
});
