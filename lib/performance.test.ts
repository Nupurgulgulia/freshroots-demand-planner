import { describe, expect, it } from "vitest";
import {
  forecastAccuracy,
  healthyCoverShare,
  isMeasurable,
  outcomeSummary,
  overrideRate,
  quarterOf,
  reviewTurnaroundHours,
  rupeeExposure,
  runTrend,
  type RunOutcomeInput,
  type SalesLookup,
} from "./performance";
import { weeksAfter } from "./rules/weeks";

const sales: SalesLookup = new Map([
  // A: forecast 100, actual average 100 (perfect). B: forecast 100, actual average 50.
  ["A", new Map([["2026-W43", 90], ["2026-W44", 110], ["2026-W45", 100], ["2026-W46", 100]])],
  ["B", new Map([["2026-W43", 50], ["2026-W44", 50], ["2026-W45", 50], ["2026-W46", 50]])],
  // C is missing a week, so it is left out of accuracy.
  ["C", new Map([["2026-W43", 10], ["2026-W44", 10], ["2026-W45", 10]])],
]);

const t0 = new Date("2026-10-20T00:00:00Z");
const hoursLater = (h: number) => new Date(t0.getTime() + h * 3_600_000);

const run = (id: number, nowWeek = "2026-W42", recs?: RunOutcomeInput["recs"]): RunOutcomeInput => ({
  id,
  nowWeek,
  createdAt: t0,
  recs: recs ?? [
    { skuId: "A", status: "APPROVED", forecast: 100, firstDecisionAt: hoursLater(2) },
    { skuId: "B", status: "EDITED", forecast: 100, firstDecisionAt: hoursLater(6) },
    { skuId: "C", status: "REJECTED", forecast: 10, firstDecisionAt: hoursLater(10) },
    { skuId: "D", status: "NO_ACTION", forecast: 40, firstDecisionAt: null },
  ],
});

describe("outcome tracking", () => {
  it("needs the 4 complete weeks after a run before it can be measured", () => {
    expect(weeksAfter("2026-W42", 4)).toEqual(["2026-W43", "2026-W44", "2026-W45", "2026-W46"]);
    expect(weeksAfter("2026-W52", 2)).toEqual(["2026-W53", "2027-W01"]); // 2026 has 53 ISO weeks
    expect(isMeasurable("2026-W42", "2026-W45")).toBe(false);
    expect(isMeasurable("2026-W42", "2026-W46")).toBe(true);
    expect(isMeasurable("2026-W42", null)).toBe(false);
  });

  it("measures volume-weighted accuracy (1 − WAPE) and bias, skipping SKUs with a missing week", () => {
    const a = forecastAccuracy(run(1), sales)!;
    // |100−100| + |50−100| = 50 over actual 100 + 50 = 150 → accuracy 1 − 50/150.
    expect(a.skus).toBe(2);
    expect(a.accuracy).toBeCloseTo(1 - 50 / 150, 9);
    expect(a.bias).toBeCloseTo(50 / 150, 9); // forecast was too high
  });

  it("counts edited and rejected decisions as overrides", () => {
    expect(overrideRate(run(1).recs)).toEqual({ rate: 2 / 3, decided: 3, overridden: 2 });
    expect(overrideRate([{ skuId: "A", status: "PENDING", forecast: 1, firstDecisionAt: null }])).toBeNull();
  });

  it("takes the median hours to the first decision", () => {
    expect(reviewTurnaroundHours(run(1))).toBe(6);
  });

  it("checks whether decided SKUs now sit inside their healthy cover band", () => {
    const cover = new Map([
      ["A", { cover: 8, stockout: 6, overstock: 14 }],
      ["B", { cover: 2, stockout: 6, overstock: 14 }],
      ["C", { cover: null, stockout: 6, overstock: 14 }],
    ]);
    expect(healthyCoverShare(["A", "B", "C", "A"], cover)).toEqual({ share: 0.5, healthy: 1, measured: 2 });
  });

  it("summarises only measurable weeks, counting the latest run of each week once", () => {
    const cover = new Map([["A", { cover: 8, stockout: 6, overstock: 14 }]]);
    const early = run(1); // same week as run 2: ignored in favour of run 2
    const later = run(2);
    const tooRecent = run(3, "2026-W45");
    const s = outcomeSummary([early, later, tooRecent], sales, "2026-W46", cover);
    expect(s.measurableRuns).toBe(1);
    expect(s.accuracy).toBeCloseTo(1 - 50 / 150, 9);
    expect(s.override?.decided).toBe(3);
    expect(s.healthyCover).toEqual({ share: 1, healthy: 1, measured: 1 });

    const trend = runTrend([tooRecent, later], sales, "2026-W46");
    expect(trend.map((t) => [t.runId, t.measurable, t.accuracy != null])).toEqual([
      [2, true, true],
      [3, false, false],
    ]);
    expect(trend[1].overrideRate).toBeCloseTo(2 / 3, 9); // overrides are known straight away
  });

  it("computes rupee exposure only from SKUs with a price, and never a saving", () => {
    const e = rupeeExposure([
      { unitPrice: 10, unitsOnHand: 100, flag: "OVERSTOCK", overstockLimitUnits: 60, readyOrderQty: 0 },
      { unitPrice: 2, unitsOnHand: 50, flag: "STOCKOUT", overstockLimitUnits: 500, readyOrderQty: 300 },
      { unitPrice: null, unitsOnHand: 999, flag: "OVERSTOCK", overstockLimitUnits: 1, readyOrderQty: 999 },
    ])!;
    expect(e).toEqual({ stock: 1100, aboveOverstock: 400, orders: 600, pricedSkus: 2, totalSkus: 3 });
    expect(rupeeExposure([{ unitPrice: null, unitsOnHand: 1, flag: "X", overstockLimitUnits: 1, readyOrderQty: 1 }])).toBeNull();
  });

  it("names calendar quarters", () => {
    expect(quarterOf(new Date("2026-11-06T00:00:00Z"))).toBe("2026-Q4");
    expect(quarterOf(new Date("2026-01-01T00:00:00Z"))).toBe("2026-Q1");
  });
});
