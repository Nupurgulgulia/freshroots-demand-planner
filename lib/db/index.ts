// Database client. Uses Neon when DATABASE_URL is set, otherwise an embedded
// PGlite database in ./.pglite so the app runs locally with no setup.

import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");
const MIGRATION_LOCK_ID = 727_274_001;

const globalForDb = globalThis as unknown as { dbPromise?: Promise<Db>; close?: () => Promise<void> };

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-serverless");
    const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
    const pool = new Pool({ connectionString: url });
    globalForDb.close = () => pool.end();
    // Several serverless instances can cold-start at once; an advisory lock makes
    // them apply migrations one at a time instead of racing on CREATE TABLE.
    const lockClient = await pool.connect();
    try {
      await lockClient.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
      await migrate(drizzle({ client: lockClient, schema }), { migrationsFolder: MIGRATIONS });
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
      lockClient.release();
    }
    return drizzle({ client: pool, schema }) as unknown as Db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".pglite");
  const client = new PGlite(dataDir);
  globalForDb.close = () => client.close();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

/** Shared connection; migrations run once per process on first use. */
export function getDb(): Promise<Db> {
  globalForDb.dbPromise ??= connect().catch((err) => {
    globalForDb.dbPromise = undefined;
    throw err;
  });
  return globalForDb.dbPromise;
}

/** Closes the connection; used by scripts so PGlite shuts down cleanly. */
export async function closeDb() {
  await globalForDb.close?.();
  globalForDb.dbPromise = undefined;
  globalForDb.close = undefined;
}

export { schema };
