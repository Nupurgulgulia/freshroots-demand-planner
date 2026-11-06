// Rebuilds the end-to-end test database from scratch: the sample CSVs, one engine run, and the test users.
// Refuses to run against anything but a local PGlite folder, so it can never touch the live database.
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { E2E_USERS } from "./users";

const dir = process.env.PGLITE_DIR;
if (!dir || !dir.startsWith(".pglite-e2e") || process.env.DATABASE_URL) {
  console.error("e2e/seed.ts only runs with PGLITE_DIR=.pglite-e2e and no DATABASE_URL (use `npm run e2e`).");
  process.exit(1);
}

async function main() {
  rmSync(path.join(process.cwd(), dir!), { recursive: true, force: true });
  const { closeDb, getDb } = await import("@/lib/db");
  const { importCsv } = await import("@/lib/data/load");
  const { runEngine } = await import("@/lib/run-engine");
  const { getThresholds } = await import("@/lib/settings");
  const { upsertUser } = await import("@/lib/users");

  const db = await getDb();
  for (const d of ["distributor_master", "sku_master", "calendar", "weekly_sales", "current_inventory"] as const) {
    const file = path.join(process.cwd(), "data", `${d}.csv`);
    if (!existsSync(file)) throw new Error(`Missing ${file}`);
    const r = await importCsv(db, d, readFileSync(file, "utf8"), `${d}.csv`, "e2e");
    if (!r.ok) throw new Error(`${d}: ${r.errors.join("; ")}`);
  }
  await getThresholds(db);
  await runEngine(db, "e2e");
  for (const [role, u] of Object.entries(E2E_USERS)) {
    const r = await upsertUser(db, {
      username: u.username,
      role,
      email: `${u.username}@example.test`,
      password: u.password,
    });
    if (!r.ok) throw new Error(`${u.username}: ${r.error}`);
  }
  await closeDb();
  console.log("e2e database ready");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
