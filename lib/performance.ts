// Outcome tracking: how did past recommendations and decisions turn out? Pure functions, unit-tested.
//
// A run is "measurable" once the sales data contains the 4 complete weeks after it. Only then can its
// forecast be compared with what actually sold.

import { weeksAfter } from "@/lib/rules/weeks";

export const OUTCOME_WEEKS = 4;

export interface RunOutcomeInput {
  id: number;
  nowWeek: string;
  createdAt: Date;
  recs: {
    skuId: string;
    status: string; // PENDING | APPROVED | EDITED | REJECTED | NO_ACTION
    /** The demand baseline (units/week) the engine used: the forecast being checked. */
    forecast: number | null;
    /** When the first decision on it was recorded. */
    firstDecisionAt: Date | null;
  }[];
}

/** Units sold by SKU and ISO week. */
export type SalesLookup = Map<string, Map<string, number>>;

export type CoverLookup = Map<string, { cover: number | null; stockout: number; overstock: number }>;

const DECIDED = new Set(["APPROVED", "EDITED", "REJECTED"]);

export function isMeasurable(nowWeek: string, latestSalesWeek: string | null): boolean {
  if (!latestSalesWeek) return false;
  return weeksAfter(nowWeek, OUTCOME_WEEKS).at(-1)! <= latestSalesWeek;
}

/** Sum of |actual − forecast|, sum of (forecast − actual) and sum of actual, per SKU average week. */
function errorSums(run: Pick<RunOutcomeInput, "nowWeek" | "recs">, sales: SalesLookup) {
  const weeks = weeksAfter(run.nowWeek, OUTCOME_WEEKS);
  let absErr = 0;
  let signedErr = 0;
  let actualSum = 0;
  let skus = 0;
  for (const r of run.recs) {
    if (r.forecast == null || !(r.forecast > 0)) continue;
    const bySku = sales.get(r.skuId);
    const values = weeks.map((w) => bySku?.get(w));
    if (values.some((v) => v == null)) continue; // a missing week: leave this SKU out
    const actual = (values as number[]).reduce((a, b) => a + b, 0) / weeks.length;
    absErr += Math.abs(actual - r.forecast);
    signedErr += r.forecast - actual;
    actualSum += actual;
    skus++;
  }
  return { absErr, signedErr, actualSum, skus };
}

/**
 * Volume-weighted forecast accuracy (1 − WAPE) over the 4 weeks after the run:
 * 1 − Σ|actual − forecast| ÷ Σ actual, using each SKU's average weekly sales in those weeks.
 * Bias > 0 means the forecast was too high.
 */
export function forecastAccuracy(run: Pick<RunOutcomeInput, "nowWeek" | "recs">, sales: SalesLookup) {
  const s = errorSums(run, sales);
  if (s.skus === 0 || s.actualSum === 0) return null;
  return { accuracy: Math.max(0, 1 - s.absErr / s.actualSum), bias: s.signedErr / s.actualSum, skus: s.skus };
}

/** Share of decisions where the planner changed (edited) or rejected the engine's recommendation. */
export function overrideRate(recs: RunOutcomeInput["recs"]) {
  const decided = recs.filter((r) => DECIDED.has(r.status));
  if (decided.length === 0) return null;
  const overridden = decided.filter((r) => r.status === "EDITED" || r.status === "REJECTED").length;
  return { rate: overridden / decided.length, decided: decided.length, overridden };
}

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

function turnaroundList(run: Pick<RunOutcomeInput, "createdAt" | "recs">) {
  return run.recs
    .filter((r) => r.firstDecisionAt != null && DECIDED.has(r.status))
    .map((r) => Math.max(0, (r.firstDecisionAt!.getTime() - run.createdAt.getTime()) / 3_600_000));
}

/** Median hours from the run being created to the first decision on each recommendation. */
export function reviewTurnaroundHours(run: Pick<RunOutcomeInput, "createdAt" | "recs">) {
  return median(turnaroundList(run));
}

/** For SKUs that had a decision, the share whose latest weeks of cover sits inside the healthy band. */
export function healthyCoverShare(skuIds: Iterable<string>, latestCover: CoverLookup) {
  let healthy = 0;
  let measured = 0;
  for (const id of new Set(skuIds)) {
    const c = latestCover.get(id);
    if (!c || c.cover == null) continue;
    measured++;
    if (c.cover >= c.stockout && c.cover <= c.overstock) healthy++;
  }
  return measured ? { share: healthy / measured, healthy, measured } : null;
}

export interface RunTrendPoint {
  runId: number;
  week: string;
  measurable: boolean;
  accuracy: number | null;
  bias: number | null;
  overrideRate: number | null;
  turnaroundHours: number | null;
  decided: number;
}

/** One point per run, oldest first. Accuracy only for runs that are measurable. */
export function runTrend(runs: RunOutcomeInput[], sales: SalesLookup, latestSalesWeek: string | null): RunTrendPoint[] {
  return [...runs]
    .sort((a, b) => a.id - b.id)
    .map((run) => {
      const measurable = isMeasurable(run.nowWeek, latestSalesWeek);
      const acc = measurable ? forecastAccuracy(run, sales) : null;
      const ov = overrideRate(run.recs);
      return {
        runId: run.id,
        week: run.nowWeek,
        measurable,
        accuracy: acc?.accuracy ?? null,
        bias: acc?.bias ?? null,
        overrideRate: ov?.rate ?? null,
        turnaroundHours: reviewTurnaroundHours(run),
        decided: ov?.decided ?? 0,
      };
    });
}

/**
 * Headline figures over decisions that are at least 4 complete weeks old. When several runs share a
 * week, only the latest run of that week counts, so a recalculation isn't counted twice.
 */
export function outcomeSummary(
  runs: RunOutcomeInput[],
  sales: SalesLookup,
  latestSalesWeek: string | null,
  latestCover: CoverLookup,
) {
  const latestPerWeek = new Map<string, RunOutcomeInput>();
  for (const r of runs) {
    const cur = latestPerWeek.get(r.nowWeek);
    if (!cur || r.id > cur.id) latestPerWeek.set(r.nowWeek, r);
  }
  const measurable = [...latestPerWeek.values()].filter((r) => isMeasurable(r.nowWeek, latestSalesWeek));
  const allRecs = measurable.flatMap((r) => r.recs);

  // Pool accuracy over all measurable runs (volume-weighted across runs too).
  let absErr = 0;
  let actualSum = 0;
  let skus = 0;
  for (const r of measurable) {
    const s = errorSums(r, sales);
    absErr += s.absErr;
    actualSum += s.actualSum;
    skus += s.skus;
  }
  const decidedSkus = allRecs.filter((r) => DECIDED.has(r.status)).map((r) => r.skuId);

  return {
    measurableRuns: measurable.length,
    accuracy: actualSum > 0 ? Math.max(0, 1 - absErr / actualSum) : null,
    accuracySkus: skus,
    override: overrideRate(allRecs),
    healthyCover: healthyCoverShare(decidedSkus, latestCover),
    turnaroundHours: median(measurable.flatMap(turnaroundList)),
  };
}

/** Rupee exposure from Unit_Price. Only SKUs with a price count; nothing here is a saving. */
export function rupeeExposure(
  lines: {
    unitPrice: number | null;
    unitsOnHand: number | null;
    flag: string;
    overstockLimitUnits: number | null;
    readyOrderQty: number;
  }[],
) {
  const priced = lines.filter((l) => l.unitPrice != null);
  if (priced.length === 0) return null;
  let stock = 0;
  let aboveOverstock = 0;
  let orders = 0;
  for (const l of priced) {
    const p = l.unitPrice!;
    stock += (l.unitsOnHand ?? 0) * p;
    if (l.flag === "OVERSTOCK" && l.overstockLimitUnits != null && l.unitsOnHand != null) {
      aboveOverstock += Math.max(0, l.unitsOnHand - l.overstockLimitUnits) * p;
    }
    orders += l.readyOrderQty * p;
  }
  return { stock, aboveOverstock, orders, pricedSkus: priced.length, totalSkus: lines.length };
}

/** "2026-Q3" for a date, using calendar quarters. */
export function quarterOf(date: Date): string {
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

export function isValidQuarter(q: string): boolean {
  return /^\d{4}-Q[1-4]$/.test(q);
}
