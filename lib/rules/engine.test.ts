import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDataset, type DatasetName } from "@/lib/data/csv";
import {
  DEFAULT_THRESHOLDS,
  evaluateAll,
  evaluateSku,
  type EngineContext,
  type SkuInput,
} from "./engine";
import { buildEngineInputs } from "./inputs";
import { weeksEndingAt } from "./weeks";

function load<D extends DatasetName>(name: D) {
  const csv = readFileSync(path.join(__dirname, "../../data", `${name}.csv`), "utf8");
  const { rows, errors } = parseDataset(name, csv);
  expect(errors).toEqual([]);
  return rows;
}

function evaluateProvidedData() {
  const inputs = buildEngineInputs({
    skus: load("sku_master").map((s) => ({
      skuId: s.SKU_ID,
      perishability: s.Perishability,
      standardReorderQty: s.Standard_Reorder_Qty,
      distributorId: s.Distributor_ID,
    })),
    distributors: load("distributor_master").map((d) => ({
      distributorId: d.Distributor_ID,
      status: d.Status,
    })),
    sales: load("weekly_sales").map((s) => ({ skuId: s.SKU_ID, week: s.Week, unitsSold: s.Units_Sold })),
    inventory: load("current_inventory").map((r) => ({
      skuId: r.SKU_ID,
      location: r.Location,
      unitsOnHand: r.Units_On_Hand,
      asOfDate: r.As_Of_Date,
    })),
    calendar: load("calendar").map((c) => ({
      yearMonth: c.Year_Month,
      isFestivalMonth: c.Is_Festival_Month,
    })),
  });
  expect(inputs.nowWeek).toBe("2026-W42");
  const results = evaluateAll(inputs.skus, {
    nowWeek: inputs.nowWeek!,
    festivalCalendar: inputs.festivalCalendar,
    thresholds: DEFAULT_THRESHOLDS,
  });
  return new Map(results.map((r) => [r.skuId, r]));
}

describe("provided data (acceptance check)", () => {
  const results = evaluateProvidedData();

  it("evaluates all 15 SKUs", () => {
    expect(results.size).toBe(15);
  });

  it("applies the October festival uplift to every SKU", () => {
    for (const r of results.values()) {
      expect(r.festivalMonth).toBe(true);
      expect(r.demandBaseline).toBeCloseTo(r.avg12! * 1.25, 9);
    }
  });

  it("SKU001: stockout risk + high demand -> exception, reorder 750", () => {
    const r = results.get("SKU001")!;
    expect(r.stockoutRisk).toBe(true);
    expect(r.highDemand).toBe(true);
    expect(r.isException).toBe(true);
    expect(r.flag).toBe("EXCEPTION");
    expect(r.action).toBe("REORDER");
    expect(r.quantity).toBe(750);
    expect(r.rulesFired).toEqual(
      expect.arrayContaining(["FESTIVAL_UPLIFT", "STOCKOUT_RISK", "HIGH_DEMAND", "STOCKOUT_AND_HIGH_DEMAND"]),
    );
    expect(r.avg12).toBeCloseTo(214.9167, 3);
    expect(r.avg4).toBeCloseTo(261, 9);
    expect(r.weeksOfCover).toBeCloseTo(900 / (214.91667 * 1.25), 3);
  });

  it.each([
    ["SKU003", 300],
    ["SKU004", 150],
    ["SKU011", 500],
    ["SKU013", 120],
  ])("%s: stockout risk, reorder %i", (id, qty) => {
    const r = results.get(id)!;
    expect(r.flag).toBe("STOCKOUT");
    expect(r.action).toBe("REORDER");
    expect(r.quantity).toBe(qty);
    expect(r.isException).toBe(false);
    expect(r.highDemand).toBe(false);
  });

  it.each(["SKU006", "SKU007"])("%s: overstock risk, pause next order", (id) => {
    const r = results.get(id)!;
    expect(r.flag).toBe("OVERSTOCK");
    expect(r.action).toBe("PAUSE");
    expect(r.quantity).toBeNull();
    expect(r.isException).toBe(false);
  });

  it.each(["SKU002", "SKU005", "SKU008", "SKU009", "SKU010", "SKU012", "SKU014", "SKU015"])(
    "%s: no action",
    (id) => {
      const r = results.get(id)!;
      expect(r.flag).toBe("NO_ACTION");
      expect(r.action).toBe("NONE");
      expect(r.isException).toBe(false);
      expect(r.rulesFired).toContain("NO_ACTION");
    },
  );
});

// ---------- Synthetic edge cases ----------

const NOW = "2026-W42";
const octoberFestival = new Map([
  ["2026-10", true],
  ["2026-09", false],
]);

function ctx(overrides: Partial<EngineContext> = {}): EngineContext {
  return { nowWeek: NOW, festivalCalendar: octoberFestival, thresholds: DEFAULT_THRESHOLDS, ...overrides };
}

/** 12 weeks: 8 weeks at `base`, then 4 weeks at `recent`. */
function sku(opts: {
  base?: number;
  recent?: number;
  onHand?: number;
  perishability?: string | null;
  std?: number | null;
  weeks?: number;
  asOf?: string;
  status?: string | null;
}): SkuInput {
  const { base = 100, recent = base, onHand = 1000, weeks = 12 } = opts;
  const all = weeksEndingAt(NOW, weeks);
  return {
    skuId: "T",
    perishability: opts.perishability === undefined ? "Low" : opts.perishability,
    standardReorderQty: opts.std === undefined ? 100 : opts.std,
    distributorStatus: opts.status === undefined ? "Active" : opts.status,
    sales: all.map((week, i) => ({ week, unitsSold: i >= all.length - 4 ? recent : base })),
    inventory: [{ location: "WH", unitsOnHand: onHand, asOfDate: opts.asOf ?? "2026-10-19" }],
  };
}

describe("festival uplift", () => {
  it("uses avg12 without uplift in a non-festival month", () => {
    const r = evaluateSku(sku({ onHand: 1000, asOf: "2026-09-30" }), ctx());
    expect(r.festivalMonth).toBe(false);
    expect(r.demandBaseline).toBe(100);
    expect(r.weeksOfCover).toBe(10);
  });

  it("multiplies the baseline by 1.25 in a festival month", () => {
    const r = evaluateSku(sku({ onHand: 1000 }), ctx());
    expect(r.demandBaseline).toBe(125);
    expect(r.weeksOfCover).toBe(8);
    expect(r.rulesFired).toContain("FESTIVAL_UPLIFT");
  });

  it("flags missing calendar month as an exception", () => {
    const r = evaluateSku(sku({ asOf: "2026-12-01" }), ctx());
    expect(r.isException).toBe(true);
    expect(r.action).toBe("REVIEW");
    expect(r.rulesFired).toContain("MISSING_DATA");
  });
});

describe("thresholds are strict and depend on perishability", () => {
  // Non-festival month so baseline = 100.
  const sep = { asOf: "2026-09-15" };

  it("cover exactly 6 weeks is not a stockout (Low)", () => {
    expect(evaluateSku(sku({ ...sep, onHand: 600 }), ctx()).stockoutRisk).toBe(false);
    expect(evaluateSku(sku({ ...sep, onHand: 599 }), ctx()).stockoutRisk).toBe(true);
  });

  it("cover exactly 14 weeks is not overstock (Low)", () => {
    expect(evaluateSku(sku({ ...sep, onHand: 1400 }), ctx()).overstockRisk).toBe(false);
    expect(evaluateSku(sku({ ...sep, onHand: 1401 }), ctx()).overstockRisk).toBe(true);
  });

  it("uses 3 and 4 weeks for High perishability", () => {
    const high = { ...sep, perishability: "High" };
    expect(evaluateSku(sku({ ...high, onHand: 299 }), ctx()).flag).toBe("STOCKOUT");
    expect(evaluateSku(sku({ ...high, onHand: 350 }), ctx()).flag).toBe("NO_ACTION");
    expect(evaluateSku(sku({ ...high, onHand: 401 }), ctx()).flag).toBe("OVERSTOCK");
  });

  it("honours edited thresholds", () => {
    const thresholds = { ...DEFAULT_THRESHOLDS, stockoutWeeks: 8 };
    expect(evaluateSku(sku({ ...sep, onHand: 700 }), ctx({ thresholds })).flag).toBe("STOCKOUT");
  });
});

describe("high demand", () => {
  const sep = { asOf: "2026-09-15", onHand: 1000 };

  it("fires when avg4 > 1.2 x avg12 and reorders 1.5 x standard", () => {
    // avg12 = (8*100 + 4*200)/12 = 133.33; avg4 = 200 -> ratio 1.5
    const r = evaluateSku(sku({ ...sep, recent: 200, std: 150 }), ctx());
    expect(r.highDemand).toBe(true);
    expect(r.flag).toBe("HIGH_DEMAND");
    expect(r.action).toBe("REORDER");
    expect(r.quantity).toBe(225);
    expect(r.isException).toBe(false);
  });

  it("does not fire at exactly 1.2 x avg12", () => {
    // base 90, recent 120 -> avg12 = (720 + 480)/12 = 100; avg4 = 120
    const r = evaluateSku(sku({ ...sep, base: 90, recent: 120 }), ctx());
    expect(r.avg12).toBe(100);
    expect(r.highDemand).toBe(false);
  });

  it("rounds a fractional 1.5x quantity up to whole units", () => {
    const r = evaluateSku(sku({ ...sep, recent: 200, std: 75 }), ctx());
    expect(r.quantity).toBe(113);
  });

  it("overstock + high demand -> pause, marked as exception", () => {
    const r = evaluateSku(sku({ asOf: "2026-09-15", onHand: 5000, recent: 200 }), ctx());
    expect(r.overstockRisk).toBe(true);
    expect(r.highDemand).toBe(true);
    expect(r.action).toBe("PAUSE");
    expect(r.isException).toBe(true);
    expect(r.rulesFired).toContain("OVERSTOCK_AND_HIGH_DEMAND");
  });
});

describe("exceptions for missing data", () => {
  it("fewer than 12 weeks of history", () => {
    const r = evaluateSku(sku({ weeks: 8 }), ctx());
    expect(r.weeksOfHistory).toBe(8);
    expect(r.isException).toBe(true);
    expect(r.action).toBe("REVIEW");
    expect(r.quantity).toBeNull();
    expect(r.rulesFired).toContain("SHORT_HISTORY");
  });

  it("a gap inside the last 12 weeks", () => {
    const s = sku({ weeks: 16 });
    s.sales = s.sales.filter((x) => x.week !== "2026-W40");
    const r = evaluateSku(s, ctx());
    expect(r.missingWeeks).toEqual(["2026-W40"]);
    expect(r.action).toBe("REVIEW");
    expect(r.rulesFired).toContain("MISSING_DATA");
  });

  it("no inventory record", () => {
    const s = sku({});
    s.inventory = [];
    const r = evaluateSku(s, ctx());
    expect(r.unitsOnHand).toBeNull();
    expect(r.action).toBe("REVIEW");
  });

  it("zero sales for 12 weeks", () => {
    const r = evaluateSku(sku({ base: 0 }), ctx());
    expect(r.weeksOfCover).toBeNull();
    expect(r.action).toBe("REVIEW");
  });

  it("missing perishability or reorder quantity", () => {
    expect(evaluateSku(sku({ perishability: null }), ctx()).action).toBe("REVIEW");
    expect(evaluateSku(sku({ std: null }), ctx()).action).toBe("REVIEW");
  });

  it("an inactive distributor keeps the recommendation but needs review", () => {
    const r = evaluateSku(sku({ asOf: "2026-09-15", onHand: 300, status: "Inactive" }), ctx());
    expect(r.action).toBe("REORDER");
    expect(r.quantity).toBe(100);
    expect(r.isException).toBe(true);
    expect(r.flag).toBe("EXCEPTION");
  });

  it("sums stock across locations", () => {
    const s = sku({ asOf: "2026-09-15" });
    s.inventory = [
      { location: "A", unitsOnHand: 300, asOfDate: "2026-09-15" },
      { location: "B", unitsOnHand: 400, asOfDate: "2026-09-15" },
    ];
    expect(evaluateSku(s, ctx()).unitsOnHand).toBe(700);
  });
});

describe("open purchase orders", () => {
  // Non-festival month so baseline = 100 units/week.
  const sep = { asOf: "2026-09-15" };

  it("counts units on order in weeks of cover, so a stockout already covered by a PO is not reordered", () => {
    const s = { ...sku({ ...sep, onHand: 400 }), unitsOnOrder: 300 };
    const r = evaluateSku(s, ctx());
    expect(r.unitsOnHand).toBe(400);
    expect(r.unitsOnOrder).toBe(300);
    expect(r.stockPosition).toBe(700);
    expect(r.weeksOfCover).toBe(7);
    expect(r.flag).toBe("NO_ACTION");
    expect(r.reason).toContain("incl. 300 on order");
  });

  it("still reorders when on hand + on order stays below the minimum", () => {
    const r = evaluateSku({ ...sku({ ...sep, onHand: 400 }), unitsOnOrder: 150 }, ctx());
    expect(r.weeksOfCover).toBe(5.5);
    expect(r.flag).toBe("STOCKOUT");
    expect(r.quantity).toBe(100);
  });

  it("can tip a SKU into overstock", () => {
    const r = evaluateSku({ ...sku({ ...sep, onHand: 1000 }), unitsOnOrder: 500 }, ctx());
    expect(r.flag).toBe("OVERSTOCK");
  });

  it("treats a missing on-order figure as zero", () => {
    expect(evaluateSku(sku({ ...sep, onHand: 400 }), ctx()).unitsOnOrder).toBe(0);
  });
});

describe("buildEngineInputs: open purchase orders", () => {
  const base = {
    skus: [{ skuId: "A", perishability: "Low", standardReorderQty: 100, distributorId: "D1" }],
    distributors: [{ distributorId: "D1", status: "Active" }],
    sales: [{ skuId: "A", week: NOW, unitsSold: 10 }],
    inventory: [{ skuId: "A", location: "WH", unitsOnHand: 50, asOfDate: "2026-10-19" }],
    calendar: [],
  };

  it("sums outstanding units of open and partially received POs only", () => {
    const { skus } = buildEngineInputs({
      ...base,
      openPurchaseOrders: [
        { skuId: "A", orderedQty: 300, receivedQty: 0, status: "Open" },
        { skuId: "A", orderedQty: 200, receivedQty: 120, status: "Partially Received" },
        { skuId: "A", orderedQty: 100, receivedQty: 0, status: "issued" },
        { skuId: "A", orderedQty: 999, receivedQty: 0, status: "Draft" },
        { skuId: "A", orderedQty: 999, receivedQty: 0, status: "Cancelled" },
        { skuId: "A", orderedQty: 999, receivedQty: 999, status: "Received" },
        { skuId: "B", orderedQty: 50, receivedQty: 0, status: "Open" },
      ],
    });
    expect(skus[0].unitsOnOrder).toBe(300 + 80 + 100);
  });

  it("is zero when there are no POs", () => {
    expect(buildEngineInputs(base).skus[0].unitsOnOrder).toBe(0);
  });
});
