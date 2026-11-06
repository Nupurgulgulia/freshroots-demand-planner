// Phase 4: draft purchase orders to Zoho, run end to end against the mock Zoho server
// (real client code, real HTTP) on a throwaway in-memory database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { can } from "@/lib/permissions";
import { createMockZoho } from "./mock-server";
import { parseMappingCsv, planDrafts, suggestMappings, zohoReference } from "./ordering";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

const mock = createMockZoho();
let runId = 0;
const rec: Record<string, number> = {};

const { closeDb, getDb, schema } = await import("@/lib/db");
const { reviewRecommendation } = await import("@/lib/review");
const { saveMappings, sendDraftsToZoho, getDraftPlan } = await import("./ordering");
const { fetchOpenPurchaseOrders, fetchVendorsAndItems, zohoConfig, ZohoApiError } = await import("./inventory");

const user = { username: "proc", id: null };

beforeAll(async () => {
  const base = await mock.listen(0);
  Object.assign(process.env, {
    ZOHO_CLIENT_ID: "mock",
    ZOHO_CLIENT_SECRET: "mock",
    ZOHO_REFRESH_TOKEN: "mock",
    ZOHO_ORG_ID: "mock-org",
    ZOHO_API_BASE: base,
    ZOHO_ACCOUNTS_BASE: base,
  });
  const db = await getDb();
  await db.insert(schema.distributors).values([
    { distributorId: "DIST001", name: "NutriFlow Distributors", region: "MH", status: "Active" },
    { distributorId: "DIST002", name: "GrainPath Logistics", region: "MH", status: "Active" },
  ]);
  await db.insert(schema.skus).values(
    ["SKU001", "SKU002", "SKU003"].map((skuId, i) => ({
      skuId,
      name: `Item ${skuId}`,
      category: "Staple",
      perishability: "Low",
      standardReorderQty: 100,
      unitOfMeasure: "Units",
      distributorId: i < 2 ? "DIST001" : "DIST002",
    })),
  );
  const [run] = await db.insert(schema.runs).values({ nowWeek: "2026-W42", thresholds: {}, triggeredBy: "t" }).returning();
  runId = run.id;
  for (const skuId of ["SKU001", "SKU002", "SKU003"]) {
    const [r] = await db
      .insert(schema.recommendations)
      .values({ runId, skuId, flag: "STOCKOUT", action: "REORDER", quantity: 100, isException: false, rulesFired: [], exceptionReasons: [], evaluation: {}, reason: "t" })
      .returning();
    rec[skuId] = r.id;
  }
  await reviewRecommendation(db, { recommendationId: rec.SKU001, decision: "APPROVE", reviewer: "p" });
  await reviewRecommendation(db, { recommendationId: rec.SKU003, decision: "APPROVE", reviewer: "p" });
  // SKU002 is edited above 3× standard and not yet confirmed, so it must stay out of the drafts.
  await reviewRecommendation(db, { recommendationId: rec.SKU002, decision: "EDIT", reviewer: "p", quantity: 500, note: "big" });
}, 60_000);

afterAll(async () => {
  await closeDb();
  await mock.close();
});

describe("Zoho draft purchase orders", () => {
  it("only procurement can send or map", () => {
    expect(can("procurement", "sendToZoho")).toBe(true);
    expect(can("procurement", "manageZohoMapping")).toBe(true);
    for (const role of ["planner", "viewer"] as const) {
      expect(can(role, "sendToZoho")).toBe(false);
      expect(can(role, "manageZohoMapping")).toBe(false);
    }
  });

  it("won't send until the distributor and every SKU are mapped", async () => {
    const db = await getDb();
    const results = await sendDraftsToZoho(db, runId, user);
    expect(results.every((r) => r.outcome === "skipped")).toBe(true);
    expect(results.map((r) => r.message).join(" ")).toMatch(/no Zoho vendor/);
    expect(mock.purchaseOrders).toHaveLength(0);
  });

  it("suggests mappings from Zoho by item SKU and vendor name", async () => {
    const zoho = await fetchVendorsAndItems(zohoConfig()!);
    const db = await getDb();
    const s = suggestMappings(zoho, {
      distributors: await db.select({ distributorId: schema.distributors.distributorId, name: schema.distributors.name }).from(schema.distributors),
      skus: await db.select({ skuId: schema.skus.skuId }).from(schema.skus),
    });
    expect(s.vendors.map((v) => [v.ourId, v.zohoId])).toEqual([
      ["DIST001", "zv-1001"],
      ["DIST002", "zv-1002"],
    ]);
    expect(s.items.map((i) => i.zohoId)).toEqual(["zi-001", "zi-002", "zi-003"]);
    await saveMappings(db, [...s.vendors, ...s.items], user);
  });

  it("creates one DRAFT per distributor with a stable reference, records the PO on each line, never issues", async () => {
    const db = await getDb();
    const results = await sendDraftsToZoho(db, runId, user, { today: "2026-11-07" });
    expect(results.map((r) => [r.distributorId, r.outcome])).toEqual([
      ["DIST001", "created"],
      ["DIST002", "created"],
    ]);
    expect(mock.purchaseOrders.map((p) => [p.reference_number, p.status, p.line_items.map((l) => [l.sku, l.quantity])])).toEqual([
      [zohoReference(runId, "DIST001"), "draft", [["SKU001", 100]]], // SKU002 (unconfirmed 500) left out
      [zohoReference(runId, "DIST002"), "draft", [["SKU003", 100]]],
    ]);
    expect(mock.issueAttempts).toBe(0);
    expect(mock.calls.some((c) => c.path.includes("/status/"))).toBe(false);

    const lines = await db.select().from(schema.recommendations);
    expect(lines.find((l) => l.id === rec.SKU001)?.zohoPurchaseorderNumber).toBe("PO-00001");
    expect(lines.find((l) => l.id === rec.SKU002)?.zohoPurchaseorderNumber).toBeNull();
  });

  it("refuses duplicates and lists lines approved after the draft was sent", async () => {
    const db = await getDb();
    const again = await sendDraftsToZoho(db, runId, user);
    expect(again.every((r) => r.outcome === "skipped" && /Already sent/.test(r.message))).toBe(true);
    expect(mock.purchaseOrders).toHaveLength(2);

    // Procurement confirms SKU002 later: it is now ready but its distributor's draft already exists.
    await db.update(schema.recommendations).set({ confirmedAt: new Date(), confirmedBy: "proc" }).where((await import("drizzle-orm")).eq(schema.recommendations.id, rec.SKU002));
    const plan = await getDraftPlan(db, runId);
    const d1 = plan.find((g) => g.distributorId === "DIST001")!;
    expect(d1.state).toBe("sent");
    expect(d1.lateLines.map((l) => l.skuId)).toEqual(["SKU002"]);
  });

  it("drafts are not counted as stock on order when open POs are synced", async () => {
    const open = await fetchOpenPurchaseOrders(zohoConfig()!);
    expect(open).toHaveLength(0);
  });
});

describe("failures and retry", () => {
  it("records a refusal per distributor and lets it be retried after a fix", async () => {
    const db = await getDb();
    const [run2] = await db.insert(schema.runs).values({ nowWeek: "2026-W43", thresholds: {}, triggeredBy: "t" }).returning();
    for (const skuId of ["SKU001", "SKU003"]) {
      const [r] = await db
        .insert(schema.recommendations)
        .values({ runId: run2.id, skuId, flag: "STOCKOUT", action: "REORDER", quantity: 50, isException: false, rulesFired: [], exceptionReasons: [], evaluation: {}, reason: "t" })
        .returning();
      await reviewRecommendation(db, { recommendationId: r.id, decision: "APPROVE", reviewer: "p" });
    }
    await saveMappings(db, [{ type: "vendor", ourId: "DIST002", zohoId: "zv-fail" }], user);
    const first = await sendDraftsToZoho(db, run2.id, user);
    expect(first.map((r) => [r.distributorId, r.outcome])).toEqual([
      ["DIST001", "created"],
      ["DIST002", "failed"],
    ]);
    expect(first[1].message).toMatch(/refuses/);

    await saveMappings(db, [{ type: "vendor", ourId: "DIST002", zohoId: "zv-1002" }], user);
    const retry = await sendDraftsToZoho(db, run2.id, user, { distributorIds: ["DIST002"] });
    expect(retry.map((r) => r.outcome)).toEqual(["created"]);
    const sends = await db.select().from(schema.zohoPoSends);
    expect(sends.find((s) => s.reference === zohoReference(run2.id, "DIST002"))).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("holds a no-answer result until someone confirms they checked Zoho", async () => {
    const db = await getDb();
    const [run3] = await db.insert(schema.runs).values({ nowWeek: "2026-W44", thresholds: {}, triggeredBy: "t" }).returning();
    const [r] = await db
      .insert(schema.recommendations)
      .values({ runId: run3.id, skuId: "SKU003", flag: "STOCKOUT", action: "REORDER", quantity: 20, isException: false, rulesFired: [], exceptionReasons: [], evaluation: {}, reason: "t" })
      .returning();
    await reviewRecommendation(db, { recommendationId: r.id, decision: "APPROVE", reviewer: "p" });

    const timeout = async () => {
      throw new ZohoApiError("Couldn't reach Zoho: timeout", false);
    };
    expect((await sendDraftsToZoho(db, run3.id, user, { createDraft: timeout }))[0].outcome).toBe("unknown");
    const blocked = await sendDraftsToZoho(db, run3.id, user);
    expect(blocked[0]).toMatchObject({ outcome: "skipped" });
    expect(blocked[0].message).toMatch(/Check Zoho/);
    const confirmed = await sendDraftsToZoho(db, run3.id, user, { confirmUnknown: true });
    expect(confirmed[0].outcome).toBe("created");
  });
});

describe("mapping CSV and plan rules", () => {
  it("parses zoho_mapping.csv and rejects bad rows", () => {
    const known = { distributors: new Set(["DIST001"]), skus: new Set(["SKU001"]) };
    const ok = parseMappingCsv("Type,Our_ID,Zoho_ID\nvendor,DIST001,zv-1\nItem,SKU001,zi-1", known);
    expect(ok).toEqual({
      rows: [
        { type: "vendor", ourId: "DIST001", zohoId: "zv-1" },
        { type: "item", ourId: "SKU001", zohoId: "zi-1" },
      ],
      errors: [],
    });
    const bad = parseMappingCsv("Type,Our_ID,Zoho_ID\nshop,DIST001,x\nvendor,DIST999,x\nitem,SKU001,", known);
    expect(bad.errors).toHaveLength(3);
    expect(parseMappingCsv("Type,Our_ID\nvendor,DIST001", known).errors[0]).toMatch(/Missing column/);
  });

  it("marks groups unmapped when a vendor or item is missing", () => {
    const groups = planDrafts(
      7,
      [
        { recommendationId: 1, skuId: "A", skuName: null, distributorId: "D1", quantity: 5, alreadyOnPo: null },
        { recommendationId: 2, skuId: "B", skuName: null, distributorId: "D2", quantity: 5, alreadyOnPo: null },
      ],
      new Map([["D1", "v1"]]),
      new Map([["A", "i1"]]),
      new Map(),
    );
    expect(groups.map((g) => [g.reference, g.state, g.missingItems])).toEqual([
      ["FR-R7-D1", "ready", []],
      ["FR-R7-D2", "unmapped", ["B"]],
    ]);
  });
});

describe("settings", () => {
  it("keeps ordering off unless ZOHO_ORDERING_ENABLED is set", async () => {
    const { zohoOrderingEnabled } = await import("./inventory");
    expect(zohoOrderingEnabled({})).toBe(false);
    expect(zohoOrderingEnabled({ ZOHO_ORDERING_ENABLED: "0" })).toBe(false);
    expect(zohoOrderingEnabled({ ZOHO_ORDERING_ENABLED: "1" })).toBe(true);
    expect(zohoOrderingEnabled({ ZOHO_ORDERING_ENABLED: "true" })).toBe(true);
  });

  it("uses the India data centre by default and only goes to the mock when told to", async () => {
    const creds = { ZOHO_CLIENT_ID: "a", ZOHO_CLIENT_SECRET: "b", ZOHO_REFRESH_TOKEN: "c", ZOHO_ORG_ID: "d" };
    expect(zohoConfig(creds)).toMatchObject({ apiBase: "https://www.zohoapis.in", accountsBase: "https://accounts.zoho.in" });
    expect(zohoConfig({ ...creds, ZOHO_DC: "com" })).toMatchObject({ apiBase: "https://www.zohoapis.com" });
    expect(zohoConfig({ ...creds, ZOHO_API_BASE: "http://127.0.0.1:4010/" })?.apiBase).toBe("http://127.0.0.1:4010");
    expect(zohoConfig({ ZOHO_CLIENT_ID: "a" })).toBeNull();
  });
});
