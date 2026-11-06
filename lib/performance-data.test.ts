// Database checks for Phase 3 on a throwaway in-memory database.
import { afterAll, describe, expect, it } from "vitest";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

const { closeDb, getDb, schema } = await import("@/lib/db");
const { importCsv } = await import("@/lib/data/load");
const { getPerformanceData, saveQuarterlyFigures, validateFigures } = await import("./performance-data");

afterAll(async () => {
  await closeDb();
});

describe("Phase 3 data", () => {
  it("keeps every stock upload as a snapshot while the rules see only the latest", async () => {
    const db = await getDb();
    const csv = (n: number) => `SKU_ID,Location,Units_On_Hand,As_Of_Date\nS1,WH,${n},2026-10-19\nS2,WH,10,2026-10-19`;
    expect((await importCsv(db, "current_inventory", csv(100), "a.csv", "t")).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 5)); // distinct snapshot times
    expect((await importCsv(db, "current_inventory", csv(70), "b.csv", "t")).ok).toBe(true);
    expect(await db.select().from(schema.inventory)).toHaveLength(2);
    expect(await db.select().from(schema.inventorySnapshots)).toHaveLength(4);
    const d = await getPerformanceData(db);
    expect(d.stockHistory.map((h) => h.units)).toEqual([110, 80]);
  }, 60_000);

  it("keeps an existing Unit_Price when a later sku_master file has no price column", async () => {
    const db = await getDb();
    const head = "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID";
    await importCsv(db, "sku_master", `${head},Unit_Price\nS1,Rice,Staple,Low,100,Units,D1,42`, "a.csv", "t");
    await importCsv(db, "sku_master", `${head}\nS1,Rice v2,Staple,Low,100,Units,D1`, "b.csv", "t");
    const [s1] = await db.select().from(schema.skus);
    expect(s1).toMatchObject({ name: "Rice v2", unitPrice: 42 });
  });

  it("saves entered quarterly figures with who entered them, and logs the change", async () => {
    const db = await getDb();
    expect(validateFigures({ quarter: "2026-Q5", baselineLoss: 1, targetLoss: null, actualLoss: null, note: null })).toMatch(/Quarter/);
    expect(validateFigures({ quarter: "2026-Q3", baselineLoss: null, targetLoss: null, actualLoss: null, note: null })).toMatch(/at least one/);
    expect(validateFigures({ quarter: "2026-Q3", baselineLoss: -5, targetLoss: null, actualLoss: null, note: null })).toMatch(/0 or more/);

    const user = { username: "deepa_via_planner", id: null as unknown as number };
    expect(
      (await saveQuarterlyFigures(db, { quarter: "2026-Q3", baselineLoss: 450000, targetLoss: 300000, actualLoss: null, note: "Finance Q3 pack" }, user)).ok,
    ).toBe(true);
    await saveQuarterlyFigures(db, { quarter: "2026-Q3", baselineLoss: 450000, targetLoss: 300000, actualLoss: 380000, note: "Actual added" }, user);
    const [q3] = await db.select().from(schema.quarterlyFigures);
    expect(q3).toMatchObject({ quarter: "2026-Q3", actualLoss: 380000, enteredBy: "deepa_via_planner" });
    const log = await db.select().from(schema.settingsLog);
    expect(log.filter((l) => l.area === "figures")).toHaveLength(2);
  });
});
