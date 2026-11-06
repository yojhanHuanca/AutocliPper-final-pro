import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function readMigrationSet(service) {
  const directory = join(repoRoot, "apps", `autoclipper-${service}-service`, "migrations");
  const journal = JSON.parse(readFileSync(join(directory, "meta", "_journal.json"), "utf8"));
  const sqlFiles = new Set(
    readdirSync(directory)
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .map((name) => name.slice(0, -4)),
  );
  return { directory, journal, sqlFiles };
}

test("Identity and Project migration journals register every SQL migration", () => {
  for (const service of ["identity", "project"]) {
    const { journal, sqlFiles } = readMigrationSet(service);
    const journalTags = journal.entries.map((entry) => entry.tag);

    assert.equal(new Set(journalTags).size, journalTags.length, `${service} has duplicate migration tags`);
    assert.deepEqual(
      [...sqlFiles].filter((tag) => !journalTags.includes(tag)),
      [],
      `${service} has SQL files missing from its journal`,
    );
    assert.deepEqual(
      journalTags.filter((tag) => !sqlFiles.has(tag)),
      [],
      `${service} journal points to a missing SQL file`,
    );
  }
});

test("Identity forward migration allows grant reads in both grant and audit constraints", () => {
  const { directory, journal } = readMigrationSet("identity");
  const tag = "0014_admin_grants_read_permission";
  assert.equal(journal.entries.at(-1)?.tag, tag);

  const sql = readFileSync(join(directory, `${tag}.sql`), "utf8");
  assert.match(sql, /DROP CONSTRAINT admin_grants_permissions_check/);
  assert.match(sql, /DROP CONSTRAINT admin_access_audit_permission_check/);
  assert.match(sql, /DROP CONSTRAINT admin_access_audit_grant_permissions_check/);
  assert.equal((sql.match(/'grants\.read'/g) ?? []).length, 3);
});

test("Project migration 0015 is journaled with its VOD import state columns", () => {
  const { directory, journal } = readMigrationSet("project");
  const tag = "0015_twitch_vod_clip_import_state";
  assert.ok(journal.entries.some((entry) => entry.tag === tag));

  const sql = readFileSync(join(directory, `${tag}.sql`), "utf8");
  assert.match(sql, /ADD COLUMN provider_resource_id/);
  assert.match(sql, /ADD COLUMN external_effect_started_at/);
});
