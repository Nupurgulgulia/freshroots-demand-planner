// Raghav's reorder rules as plain, deterministic functions. No I/O, no LLM.

import { weeksEndingAt } from "./weeks";

export const LONG_WINDOW_WEEKS = 12;
export const SHORT_WINDOW_WEEKS = 4;

export interface Thresholds {
  /** Stockout risk when cover is below this many weeks (Low perishability). */
  stockoutWeeks: number;
  /** Overstock risk when cover is above this many weeks (Low perishability). */
  overstockWeeks: number;
  /** Stockout threshold for High perishability SKUs. */
  stockoutWeeksPerishable: number;
  /** Overstock threshold for High perishability SKUs. */
  overstockWeeksPerishable: number;
  /** High demand when avg4 exceeds avg12 by more than this fraction (0.2 = 20%). */
  highDemandPct: number;
  /** Reorder multiple of Standard_Reorder_Qty when demand is high. */
  highDemandMultiplier: number;
  /** Festival-month uplift on the demand baseline (0.25 = 25%). */
  festivalUpliftPct: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  stockoutWeeks: 6,
  overstockWeeks: 14,
  stockoutWeeksPerishable: 3,
  overstockWeeksPerishable: 4,
  highDemandPct: 0.2,
  highDemandMultiplier: 1.5,
  festivalUpliftPct: 0.25,
};

export type RuleId =
  | "FESTIVAL_UPLIFT"
  | "STOCKOUT_RISK"
  | "OVERSTOCK_RISK"
  | "HIGH_DEMAND"
  | "STOCKOUT_AND_HIGH_DEMAND"
  | "OVERSTOCK_AND_HIGH_DEMAND"
  | "SHORT_HISTORY"
  | "MISSING_DATA"
  | "INACTIVE_DISTRIBUTOR"
  | "NO_ACTION";

export const RULE_LABELS: Record<RuleId, string> = {
  FESTIVAL_UPLIFT: "Festival uplift",
  STOCKOUT_RISK: "Stockout risk",
  OVERSTOCK_RISK: "Overstock risk",
  HIGH_DEMAND: "High demand",
  STOCKOUT_AND_HIGH_DEMAND: "Stockout risk with high demand",
  OVERSTOCK_AND_HIGH_DEMAND: "Overstock risk with high demand (conflict)",
  SHORT_HISTORY: "Fewer than 12 weeks of history",
  MISSING_DATA: "Missing data",
  INACTIVE_DISTRIBUTOR: "Distributor not active",
  NO_ACTION: "No action",
};

export type Flag = "EXCEPTION" | "STOCKOUT" | "OVERSTOCK" | "HIGH_DEMAND" | "NO_ACTION";
export type Action = "REORDER" | "PAUSE" | "NONE" | "REVIEW";

export const FLAG_LABELS: Record<Flag, string> = {
  EXCEPTION: "Exception",
  STOCKOUT: "Stockout risk",
  OVERSTOCK: "Overstock risk",
  HIGH_DEMAND: "High demand",
  NO_ACTION: "No action",
};

export const ACTION_LABELS: Record<Action, string> = {
  REORDER: "Reorder now",
  PAUSE: "Pause next order",
  NONE: "No action",
  REVIEW: "Planner review",
};

export interface SkuInput {
  skuId: string;
  perishability: string | null;
  standardReorderQty: number | null;
  /** Status of the SKU's distributor; null when the distributor is unknown. */
  distributorStatus: string | null;
  sales: { week: string; unitsSold: number }[];
  inventory: { location: string; unitsOnHand: number; asOfDate: string }[];
}

export interface EngineContext {
  /** Latest week in the sales data. */
  nowWeek: string;
  /** "YYYY-MM" → is festival month. */
  festivalCalendar: Map<string, boolean>;
  thresholds: Thresholds;
}

export interface Evaluation {
  skuId: string;
  perishability: "Low" | "High" | null;
  unitsOnHand: number | null;
  asOfDate: string | null;
  avg12: number | null;
  avg4: number | null;
  festivalMonth: boolean;
  demandBaseline: number | null;
  weeksOfCover: number | null;
  /** avg4 / avg12 */
  demandRatio: number | null;
  stockoutThresholdWeeks: number;
  overstockThresholdWeeks: number;
  weeksOfHistory: number;
  missingWeeks: string[];
  stockoutRisk: boolean;
  overstockRisk: boolean;
  highDemand: boolean;
  flag: Flag;
  action: Action;
  quantity: number | null;
  isException: boolean;
  exceptionReasons: string[];
  rulesFired: RuleId[];
  reason: string;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Rounds up to whole units; the epsilon stops 1.5 × 500 = 750.0000001 becoming 751. */
export const roundUpUnits = (x: number) => Math.ceil(x - 1e-9);

export function evaluateSku(sku: SkuInput, ctx: EngineContext): Evaluation {
  const t = ctx.thresholds;
  const rules: RuleId[] = [];
  // Reasons that stop the engine from recommending anything.
  const dataProblems: string[] = [];
  // Reasons that need a human but leave the recommendation in place.
  const reviewReasons: string[] = [];

  const perishability =
    sku.perishability === "High" || sku.perishability === "Low" ? sku.perishability : null;
  if (!perishability) dataProblems.push("Perishability is missing or not Low/High.");
  const isPerishable = perishability === "High";
  const stockoutThresholdWeeks = isPerishable ? t.stockoutWeeksPerishable : t.stockoutWeeks;
  const overstockThresholdWeeks = isPerishable ? t.overstockWeeksPerishable : t.overstockWeeks;

  if (sku.standardReorderQty == null || !(sku.standardReorderQty > 0)) {
    dataProblems.push("Standard reorder quantity is missing.");
  }

  // Sales history up to "now".
  const salesByWeek = new Map<string, number>();
  for (const s of sku.sales) if (s.week <= ctx.nowWeek) salesByWeek.set(s.week, s.unitsSold);
  const weeksOfHistory = salesByWeek.size;
  const window12 = weeksEndingAt(ctx.nowWeek, LONG_WINDOW_WEEKS);
  const window4 = window12.slice(-SHORT_WINDOW_WEEKS);
  const missingWeeks = window12.filter((w) => !salesByWeek.has(w));

  if (weeksOfHistory < LONG_WINDOW_WEEKS) {
    rules.push("SHORT_HISTORY");
    dataProblems.push(`Only ${weeksOfHistory} weeks of sales history (need ${LONG_WINDOW_WEEKS}).`);
  } else if (missingWeeks.length > 0) {
    dataProblems.push(`No sales recorded for ${missingWeeks.join(", ")}.`);
  }

  const present12 = window12.filter((w) => salesByWeek.has(w)).map((w) => salesByWeek.get(w)!);
  const present4 = window4.filter((w) => salesByWeek.has(w)).map((w) => salesByWeek.get(w)!);
  const avg12 = present12.length ? mean(present12) : null;
  const avg4 = present4.length ? mean(present4) : null;

  // Stock on hand, summed across locations.
  let unitsOnHand: number | null = null;
  let asOfDate: string | null = null;
  if (sku.inventory.length === 0) {
    dataProblems.push("No current inventory record.");
  } else {
    unitsOnHand = sku.inventory.reduce((a, r) => a + r.unitsOnHand, 0);
    asOfDate = sku.inventory.map((r) => r.asOfDate).sort().at(-1)!;
  }

  // Rule 1: festival uplift, based on the month of As_Of_Date.
  let festivalMonth = false;
  if (asOfDate) {
    const ym = asOfDate.slice(0, 7);
    const entry = ctx.festivalCalendar.get(ym);
    if (entry === undefined) dataProblems.push(`Festival calendar has no entry for ${ym}.`);
    festivalMonth = entry === true;
  }
  if (festivalMonth) rules.push("FESTIVAL_UPLIFT");
  const demandBaseline =
    avg12 == null ? null : festivalMonth ? avg12 * (1 + t.festivalUpliftPct) : avg12;

  // Rule 2: weeks of cover.
  let weeksOfCover: number | null = null;
  if (unitsOnHand != null && demandBaseline != null) {
    if (demandBaseline > 0) weeksOfCover = unitsOnHand / demandBaseline;
    else dataProblems.push("No sales in the last 12 weeks, so weeks of cover cannot be calculated.");
  }
  const demandRatio = avg12 && avg4 != null ? avg4 / avg12 : null;

  if (sku.distributorStatus == null) {
    reviewReasons.push("Distributor is not in the distributor master.");
  } else if (sku.distributorStatus !== "Active") {
    rules.push("INACTIVE_DISTRIBUTOR");
    reviewReasons.push(`Distributor status is ${sku.distributorStatus}.`);
  }

  const dataOk = dataProblems.length === 0;
  if (!dataOk && !rules.includes("SHORT_HISTORY")) rules.push("MISSING_DATA");

  // Rules 3-5.
  const stockoutRisk = dataOk && weeksOfCover! < stockoutThresholdWeeks;
  const overstockRisk = dataOk && weeksOfCover! > overstockThresholdWeeks;
  const highDemand = dataOk && avg4! > (1 + t.highDemandPct) * avg12!;
  if (stockoutRisk) rules.push("STOCKOUT_RISK");
  if (overstockRisk) rules.push("OVERSTOCK_RISK");
  if (highDemand) rules.push("HIGH_DEMAND");

  // Rules 6-7: combine into one recommendation.
  let flag: Flag;
  let action: Action;
  let quantity: number | null = null;
  const std = sku.standardReorderQty ?? 0;
  const boosted = roundUpUnits(std * t.highDemandMultiplier);

  if (!dataOk) {
    flag = "EXCEPTION";
    action = "REVIEW";
  } else if (stockoutRisk && highDemand) {
    rules.push("STOCKOUT_AND_HIGH_DEMAND");
    reviewReasons.push("Stockout risk and high demand both apply.");
    flag = "EXCEPTION";
    action = "REORDER";
    quantity = boosted;
  } else if (stockoutRisk) {
    flag = "STOCKOUT";
    action = "REORDER";
    quantity = std;
  } else if (overstockRisk && highDemand) {
    rules.push("OVERSTOCK_AND_HIGH_DEMAND");
    reviewReasons.push("Overstock risk and high demand conflict.");
    flag = "EXCEPTION";
    action = "PAUSE";
  } else if (overstockRisk) {
    flag = "OVERSTOCK";
    action = "PAUSE";
  } else if (highDemand) {
    flag = "HIGH_DEMAND";
    action = "REORDER";
    quantity = boosted;
  } else {
    rules.push("NO_ACTION");
    flag = "NO_ACTION";
    action = "NONE";
  }

  const exceptionReasons = [...dataProblems, ...reviewReasons];
  const isException = exceptionReasons.length > 0;
  if (isException) flag = "EXCEPTION";

  const evaluation: Omit<Evaluation, "reason"> = {
    skuId: sku.skuId,
    perishability,
    unitsOnHand,
    asOfDate,
    avg12,
    avg4,
    festivalMonth,
    demandBaseline,
    weeksOfCover,
    demandRatio,
    stockoutThresholdWeeks,
    overstockThresholdWeeks,
    weeksOfHistory,
    missingWeeks,
    stockoutRisk,
    overstockRisk,
    highDemand,
    flag,
    action,
    quantity,
    isException,
    exceptionReasons,
    rulesFired: rules,
  };
  return { ...evaluation, reason: describe(evaluation, t) };
}

const fmt = (x: number) => (Math.round(x * 10) / 10).toString();

/** Template one-line reason, used until (or instead of) a Gemini explanation. */
function describe(e: Omit<Evaluation, "reason">, t: Thresholds): string {
  if (e.action === "REVIEW") return `Needs review: ${e.exceptionReasons[0]}`;
  const cover = `${fmt(e.weeksOfCover!)} weeks of cover`;
  const trend = `last-4-week demand ${fmt(e.avg4!)}/wk vs 12-week ${fmt(e.avg12!)}/wk`;
  let text: string;
  if (e.stockoutRisk && e.highDemand) {
    text = `${cover} (below ${e.stockoutThresholdWeeks}) and ${trend}; reorder ${e.quantity} units.`;
  } else if (e.stockoutRisk) {
    text = `${cover}, below the ${e.stockoutThresholdWeeks}-week minimum; reorder ${e.quantity} units.`;
  } else if (e.overstockRisk) {
    text = `${cover}, above the ${e.overstockThresholdWeeks}-week maximum; pause the next order.`;
  } else if (e.highDemand) {
    text = `${trend} (over +${fmt(t.highDemandPct * 100)}%); reorder ${e.quantity} units.`;
  } else {
    text = `${cover}, within the ${e.stockoutThresholdWeeks}-${e.overstockThresholdWeeks} week range.`;
  }
  if (e.isException && !(e.stockoutRisk && e.highDemand)) text += ` Review: ${e.exceptionReasons[0]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function evaluateAll(skus: SkuInput[], ctx: EngineContext): Evaluation[] {
  return skus.map((s) => evaluateSku(s, ctx));
}
