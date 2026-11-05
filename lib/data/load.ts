// Writes validated CSV rows into the database.

import { getTableColumns, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { parseDataset, type DatasetName, type DatasetRow } from "./csv";

const CHUNK = 500;

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

/** `excluded.<column>` for the listed fields, for ON CONFLICT DO UPDATE SET. */
function excluded<T extends PgTable>(table: T, fields: (keyof T["_"]["columns"] & string)[]) {
  const columns = getTableColumns(table);
  return Object.fromEntries(fields.map((f) => [f, sql.raw(`excluded."${columns[f].name}"`)]));
}

/**
 * Loads one dataset. Master data, sales and calendar rows are upserted by key;
 * current_inventory is a snapshot, so it replaces the whole table.
 */
export async function saveDataset<D extends DatasetName>(db: Db, dataset: D, rows: DatasetRow<D>[]) {
  await db.transaction(async (tx) => {
    switch (dataset) {
      case "distributor_master": {
        const values = (rows as DatasetRow<"distributor_master">[]).map((r) => ({
          distributorId: r.Distributor_ID,
          name: r.Distributor_Name,
          region: r.Region,
          status: r.Status,
        }));
        for (const batch of chunks(values)) {
          await tx
            .insert(schema.distributors)
            .values(batch)
            .onConflictDoUpdate({
              target: schema.distributors.distributorId,
              set: excluded(schema.distributors, ["name", "region", "status"]),
            });
        }
        break;
      }
      case "sku_master": {
        const values = (rows as DatasetRow<"sku_master">[]).map((r) => ({
          skuId: r.SKU_ID,
          name: r.SKU_Name,
          category: r.Category,
          perishability: r.Perishability,
          standardReorderQty: r.Standard_Reorder_Qty,
          unitOfMeasure: r.Unit_of_Measure,
          distributorId: r.Distributor_ID,
        }));
        for (const batch of chunks(values)) {
          await tx
            .insert(schema.skus)
            .values(batch)
            .onConflictDoUpdate({
              target: schema.skus.skuId,
              set: excluded(schema.skus, [
                "name",
                "category",
                "perishability",
                "standardReorderQty",
                "unitOfMeasure",
                "distributorId",
              ]),
            });
        }
        break;
      }
      case "weekly_sales": {
        const values = (rows as DatasetRow<"weekly_sales">[]).map((r) => ({
          skuId: r.SKU_ID,
          week: r.Week,
          unitsSold: r.Units_Sold,
        }));
        for (const batch of chunks(values)) {
          await tx
            .insert(schema.weeklySales)
            .values(batch)
            .onConflictDoUpdate({
              target: [schema.weeklySales.skuId, schema.weeklySales.week],
              set: excluded(schema.weeklySales, ["unitsSold"]),
            });
        }
        break;
      }
      case "current_inventory": {
        const values = (rows as DatasetRow<"current_inventory">[]).map((r) => ({
          skuId: r.SKU_ID,
          location: r.Location,
          unitsOnHand: r.Units_On_Hand,
          asOfDate: r.As_Of_Date,
        }));
        await tx.delete(schema.inventory);
        for (const batch of chunks(values)) await tx.insert(schema.inventory).values(batch);
        break;
      }
      case "calendar": {
        const values = (rows as DatasetRow<"calendar">[]).map((r) => ({
          yearMonth: r.Year_Month,
          year: r.Year,
          month: r.Month,
          isFestivalMonth: r.Is_Festival_Month,
        }));
        for (const batch of chunks(values)) {
          await tx
            .insert(schema.festivalCalendar)
            .values(batch)
            .onConflictDoUpdate({
              target: schema.festivalCalendar.yearMonth,
              set: excluded(schema.festivalCalendar, ["year", "month", "isFestivalMonth"]),
            });
        }
        break;
      }
    }
  });
}

/** Parses and, if the whole file is valid, saves it. Nothing is saved when any row fails. */
export async function importCsv(db: Db, dataset: DatasetName, csv: string, fileName: string, uploadedBy: string) {
  const { rows, errors } = parseDataset(dataset, csv);
  if (errors.length > 0) return { ok: false as const, errors, rowCount: 0 };
  if (rows.length === 0) return { ok: false as const, errors: ["The file has no data rows."], rowCount: 0 };
  await saveDataset(db, dataset, rows);
  await db.insert(schema.uploads).values({ dataset, fileName, rowCount: rows.length, uploadedBy });
  return { ok: true as const, errors: [], rowCount: rows.length };
}
