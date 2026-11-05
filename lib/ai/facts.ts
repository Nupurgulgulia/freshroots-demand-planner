// What Gemini is allowed to see, and checks on what it writes back. Pure.

import { createHash } from "node:crypto";
import {
  ACTION_LABELS,
  FLAG_LABELS,
  LONG_WINDOW_WEEKS,
  RULE_LABELS,
  SHORT_WINDOW_WEEKS,
  type Evaluation,
  type Thresholds,
} from "@/lib/rules/engine";

const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

/**
 * The only data sent to Gemini: engine-computed numbers, rule names and the
 * action already decided. SKU names are left out because they contain numbers
 * (e.g. "500ml") that the number check would have to allow.
 */
export function buildFacts(
  e: Evaluation,
  sku: { category: string; standardReorderQty: number },
  t: Thresholds,
) {
  return {
    sku_id: e.skuId,
    category: sku.category,
    perishability: e.perishability,
    flag: FLAG_LABELS[e.flag],
    recommended_action: ACTION_LABELS[e.action],
    recommended_quantity_units: e.quantity,
    is_exception: e.isException,
    rules_fired: e.rulesFired.map((r) => RULE_LABELS[r]),
    exception_reasons: e.exceptionReasons,
    units_on_hand: e.unitsOnHand,
    avg_weekly_units_last_12_weeks: r1(e.avg12),
    avg_weekly_units_last_4_weeks: r1(e.avg4),
    change_4w_vs_12w_pct: e.demandRatio == null ? null : r1((e.demandRatio - 1) * 100),
    festival_month: e.festivalMonth,
    festival_uplift_pct: e.festivalMonth ? r1(t.festivalUpliftPct * 100) : null,
    demand_baseline_units_per_week: r1(e.demandBaseline),
    weeks_of_cover: r1(e.weeksOfCover),
    stockout_threshold_weeks: e.stockoutThresholdWeeks,
    overstock_threshold_weeks: e.overstockThresholdWeeks,
    high_demand_threshold_pct: r1(t.highDemandPct * 100),
    high_demand_reorder_multiplier: t.highDemandMultiplier,
    standard_reorder_quantity_units: sku.standardReorderQty,
    long_window_weeks: LONG_WINDOW_WEEKS,
    short_window_weeks: SHORT_WINDOW_WEEKS,
  };
}

export type Facts = ReturnType<typeof buildFacts>;

export function hashFacts(facts: Facts, model: string): string {
  return createHash("sha256").update(JSON.stringify({ facts, model })).digest("hex").slice(0, 16);
}

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;

/** Every number appearing in the facts, including inside strings like "2026-W40". */
export function allowedNumbers(facts: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number") out.push(v);
    else if (typeof v === "string") for (const m of v.match(NUMBER_RE) ?? []) out.push(Number(m.replace(/,/g, "")));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(facts);
  return out;
}

/**
 * Numbers in `text` that are not a supplied number (or that number rounded to
 * 0-2 decimals). Any hit means Gemini did its own arithmetic, so the text is rejected.
 */
export function findUnsupportedNumbers(text: string, allowed: number[]): string[] {
  const ok = (n: number) =>
    allowed.some((a) => [0, 1, 2].some((d) => Number(a.toFixed(d)) === n) || a === n);
  return (text.match(NUMBER_RE) ?? []).filter((m) => !ok(Number(m.replace(/,/g, ""))));
}
