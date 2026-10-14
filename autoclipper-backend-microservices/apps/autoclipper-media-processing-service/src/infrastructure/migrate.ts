import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

export async function migrateMedia(databaseUrl: string) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 30000,
  });
  const client = await pool.connect();
  try {
    // Serialize migrations across independent deployment replicas.
    await client.query("SELECT pg_advisory_lock(198351327)");
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(
        new URL("../../migrations", import.meta.url),
      ),
    });
  } finally {
    await client.query("SELECT pg_advisory_unlock(198351327)");
    client.release();
    await pool.end();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
  await migrateMedia(url);
}
