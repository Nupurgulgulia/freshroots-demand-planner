// Loads the five CSVs in /data (plus open_purchase_orders.csv if present), inserts default thresholds, and runs the engine.
// Usage: npm run db:seed   (uses DATABASE_URL if set, otherwise local PGlite)

import { config } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getDb } from "@/lib/db";
import { DATASET_NAMES, OPTIONAL_DATASETS } from "@/lib/data/csv";
import { importCsv } from "@/lib/data/load";
import { runEngine } from "@/lib/run-engine";
import { getThresholds } from "@/lib/settings";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const db = await getDb();
  console.log(process.env.DATABASE_URL ? "Using Neon (DATABASE_URL)" : "Using local PGlite in ./.pglite");

  // Masters first so later files reference known IDs.
  for (const dataset of DATASET_NAMES.slice().sort((a, b) => order(a) - order(b))) {
    const file = path.join(process.cwd(), "data", `${dataset}.csv`);
    if (OPTIONAL_DATASETS.includes(dataset) && !existsSync(file)) continue;
    const result = await importCsv(db, dataset, readFileSync(file, "utf8"), `${dataset}.csv`, "seed");
    if (!result.ok) {
      console.error(`${dataset}: rejected\n  ${result.errors.join("\n  ")}`);
      process.exit(1);
    }
    console.log(`${dataset}: ${result.rowCount} rows`);
  }

  await getThresholds(db);
  const run = await runEngine(db, "seed");
  console.log(`Engine run #${run.id} for ${run.nowWeek} saved.`);
  await closeDb();
}

function order(d: string) {
  return ["distributor_master", "sku_master", "calendar", "weekly_sales", "current_inventory", "open_purchase_orders"].indexOf(d);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
