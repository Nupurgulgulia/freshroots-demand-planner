import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, evaluateSku } from "@/lib/rules/engine";
import { weeksEndingAt } from "@/lib/rules/weeks";
import { allowedNumbers, buildFacts, findUnsupportedNumbers } from "./facts";

// A SKU shaped like SKU001: stockout risk + high demand in a festival month.
const evaluation = evaluateSku(
  {
    skuId: "SKU001",
    perishability: "Low",
    standardReorderQty: 500,
    distributorStatus: "Active",
    sales: weeksEndingAt("2026-W42", 12).map((week, i) => ({ week, unitsSold: i < 8 ? 190 : 261 })),
    inventory: [{ location: "WH", unitsOnHand: 900, asOfDate: "2026-10-19" }],
  },
  { nowWeek: "2026-W42", festivalCalendar: new Map([["2026-10", true]]), thresholds: DEFAULT_THRESHOLDS },
);
const facts = buildFacts(evaluation, { category: "Beverage", standardReorderQty: 500 }, DEFAULT_THRESHOLDS);

describe("facts sent to Gemini", () => {
  it("contains computed numbers, rule names and the decided action only", () => {
    expect(facts.recommended_action).toBe("Reorder now");
    expect(facts.recommended_quantity_units).toBe(750);
    expect(facts.rules_fired).toContain("Stockout risk with high demand");
    expect(facts.is_exception).toBe(true);
    expect(JSON.stringify(facts)).not.toMatch(/Mango|200ml/);
  });
});

describe("findUnsupportedNumbers", () => {
  const allowed = allowedNumbers(facts);

  it("accepts numbers taken from the facts, including rounded forms", () => {
    const text = `Cover is ${facts.weeks_of_cover} weeks, below ${facts.stockout_threshold_weeks}; demand rose ${facts.change_4w_vs_12w_pct}% so reorder 750 units (1.5x 500).`;
    expect(findUnsupportedNumbers(text, allowed)).toEqual([]);
  });

  it("accepts thousands separators", () => {
    expect(findUnsupportedNumbers("Reorder 1,500 units", [1500])).toEqual([]);
  });

  it("rejects numbers Gemini calculated itself", () => {
    // 750 - 500 = 250 is arithmetic the engine never supplied.
    expect(findUnsupportedNumbers("That is 250 more units than usual.", allowed)).toEqual(["250"]);
    expect(findUnsupportedNumbers("Order 800 units.", allowed)).toEqual(["800"]);
  });
});
