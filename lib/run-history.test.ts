// Phase 6: run history and comparison. Pure checks first, then two real runs on the sample data
// in a throwaway in-memory database, with a threshold change between them.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canOpen } from "./permissions";
import { compareRuns, summarise, type RunLine } from "./run-history";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

const { closeDb, getDb, schema } = await import("@/lib/db");
const { importCsv } = await import("@/lib/data/load");
const { runEngine } = await import("@/lib/run-engine");
const { getRunComparison, getRunHistory } = await import("./run-history");

const line = (skuId: string, over: Partial<RunLine> = {}): RunLine => ({
  skuId,
  name: skuId,
  flag: "NO_ACTION",
  action: "NONE",
  quantity: null,
  isException: false,
  status: "NO_ACTION",
  finalQuantity: null,
  weeksOfCover: 8,
  demandBaseline: 10,
  ...over,
});

describe("comparing runs (pure)", () => {
  it("reports flag, quantity, exception, new and dropped SKUs, and counts the rest as unchanged", () => {
    const a = [
      line("S1"),
      line("S2", { flag: "STOCKOUT", action: "REORDER", quantity: 300 }),
      line("S3", { flag: "STOCKOUT", action: "REORDER", quantity: 300 }),
      line("S4"),
      line("S5", { isException: true }),
    ];
    const b = [
      line("S1"),
      line("S2", { flag: "OVERSTOCK", action: "PAUSE" }),
      line("S3", { flag: "STOCKOUT", action: "REORDER", quantity: 450 }),
      line("S5"),
      line("S6"),
    ];
    const c = compareRuns({ lines: a, thresholds: { stockoutWeeks: 6 } }, { lines: b, thresholds: { stockoutWeeks: 8 } });
    expect(Object.fromEntries(c.changes.map((x) => [x.skuId, x.kinds]))).toEqual({
      S2: ["flag"],
      S3: ["quantity"],
      S4: ["dropped"],
      S5: ["exception"],
      S6: ["new"],
    });
    expect(c.unchanged).toBe(1);
    expect(c.thresholdChanges).toEqual([
      { label: "Stockout risk below (Low perishability)", a: 6, b: 8, unit: " wks" },
    ]);
  });

  it("ignores thresholds missing from older runs, and shows percentages as percent", () => {
    const c = compareRuns(
      { lines: [], thresholds: { highDemandPct: 0.2 } },
      { lines: [], thresholds: { highDemandPct: 0.25, maxQtyMultiple: 3 } },
    );
    expect(c.thresholdChanges).toEqual([
      { label: "High demand when 4-week avg exceeds 12-week avg by", a: 20, b: 25, unit: "%" },
    ]);
  });

  it("totals recommended and approved units, using the edited quantity when there is one", () => {
    const s = summarise([
      line("S1", { flag: "STOCKOUT", action: "REORDER", quantity: 300, status: "APPROVED" }),
      line("S2", { flag: "STOCKOUT", action: "REORDER", quantity: 500, status: "EDITED", finalQuantity: 400 }),
      line("S3", { flag: "STOCKOUT", action: "REORDER", quantity: 120, status: "PENDING" }),
      line("S4", { flag: "OVERSTOCK", action: "PAUSE", status: "REJECTED" }),
      line("S5"),
    ]);
    expect(s).toMatchObject({ recommendedUnits: 920, approvedUnits: 700, pending: 1, decided: 3, actionable: 4 });
    expect(s.flags).toMatchObject({ STOCKOUT: 3, OVERSTOCK: 1, NO_ACTION: 1 });
  });

  it("shows run history to planners and procurement but not viewers", () => {
    expect(canOpen("planner", "/runs")).toBe(true);
    expect(canOpen("procurement", "/runs")).toBe(true);
    expect(canOpen("viewer", "/runs")).toBe(false);
  });
});

describe("comparing two real runs on the sample data", () => {
  beforeAll(async () => {
    const db = await getDb();
    for (const d of ["distributor_master", "sku_master", "calendar", "weekly_sales", "current_inventory"] as const) {
      const csv = readFileSync(path.join(process.cwd(), "data", `${d}.csv`), "utf8");
      expect((await importCsv(db, d, csv, `${d}.csv`, "test")).ok).toBe(true);
    }
  }, 120_000);

  afterAll(async () => {
    await closeDb();
  });

  it("explains a change made by raising the high-demand trigger", async () => {
    const db = await getDb();
    const first = await runEngine(db, "test");
    // At 22% SKU001's +21.4% jump no longer counts as high demand (see the README).
    await db
      .insert(schema.settings)
      .values({ key: "highDemandPct", value: 0.22, updatedBy: "test" })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: 0.22 } });
    const second = await runEngine(db, "test");

    const history = await getRunHistory(db);
    expect(history.map((h) => h.run.id)).toEqual([second.id, first.id]);
    expect(history[1].summary).toMatchObject({ skus: 15, exceptions: 1, recommendedUnits: 1820 });

    const c = await getRunComparison(db, second.id, first.id); // order doesn't matter
    expect(c!.runA.id).toBe(first.id);
    expect(c!.changes.map((x) => [x.skuId, x.kinds])).toEqual([["SKU001", ["flag", "exception"]]]);
    expect(c!.changes[0].b).toMatchObject({ flag: "STOCKOUT", quantity: 500 });
    expect(c!.unchanged).toBe(14);
    expect(c!.thresholdChanges).toEqual([
      { label: "High demand when 4-week avg exceeds 12-week avg by", a: 20, b: 22, unit: "%" },
    ]);
    expect(await getRunComparison(db, first.id, first.id)).toBeNull();
    expect(await getRunComparison(db, first.id, 9999)).toBeNull();
  });
});
