import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
const service=process.argv[2];
if(!['identity','workspace','project','analysis'].includes(service))throw new Error('Unknown migration service');
if(!process.env.MIGRATION_DATABASE_URL)throw new Error('MIGRATION_DATABASE_URL required');
const pool=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL,max:1,connectionTimeoutMillis:3000});
const client=await pool.connect();
try{await client.query('SELECT pg_advisory_lock(198351327)');await migrate(drizzle(client),{migrationsFolder:fileURLToPath(new URL(`../apps/autoclipper-${service==='analysis'?'content-analysis':service}-service/migrations`,import.meta.url))});}
finally{await client.query('SELECT pg_advisory_unlock(198351327)');client.release();await pool.end();}
