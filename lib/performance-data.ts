// Loads what the Performance page needs from the database, then hands it to the pure functions in
// lib/performance.ts.

import { desc, eq, inArray, max, min, sum } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  isValidQuarter,
  outcomeSummary,
  rupeeExposure,
  runTrend,
  type CoverLookup,
  type RunOutcomeInput,
  type SalesLookup,
} from "@/lib/performance";
import { isReadyToSend } from "@/lib/review";
import type { Evaluation } from "@/lib/rules/engine";

const RUNS_SHOWN = 30;

export async function getPerformanceData(db: Db) {
  const runs = await db.select().from(schema.runs).orderBy(desc(schema.runs.id)).limit(RUNS_SHOWN);
  const runIds = runs.map((r) => r.id);

  const [recs, firstDecisions, salesRows, [latestSales], skus, figures, snapshots] = await Promise.all([
    runIds.length
      ? db.select().from(schema.recommendations).where(inArray(schema.recommendations.runId, runIds))
      : Promise.resolve([]),
    db
      .select({ recommendationId: schema.reviewAudit.recommendationId, at: min(schema.reviewAudit.createdAt) })
      .from(schema.reviewAudit)
      .where(inArray(schema.reviewAudit.decision, ["APPROVED", "EDITED", "REJECTED"]))
      .groupBy(schema.reviewAudit.recommendationId),
    db.select().from(schema.weeklySales),
    db.select({ week: max(schema.weeklySales.week) }).from(schema.weeklySales),
    db.select().from(schema.skus),
    db.select().from(schema.quarterlyFigures).orderBy(schema.quarterlyFigures.quarter),
    db
      .select({ at: schema.inventorySnapshots.snapshotAt, units: sum(schema.inventorySnapshots.unitsOnHand) })
      .from(schema.inventorySnapshots)
      .groupBy(schema.inventorySnapshots.snapshotAt)
      .orderBy(schema.inventorySnapshots.snapshotAt),
  ]);

  const firstDecisionAt = new Map(firstDecisions.map((d) => [d.recommendationId, d.at ? new Date(d.at) : null]));
  const sales: SalesLookup = new Map();
  for (const s of salesRows) {
    const m = sales.get(s.skuId) ?? new Map<string, number>();
    m.set(s.week, s.unitsSold);
    sales.set(s.skuId, m);
  }

  const recsByRun = new Map<number, typeof recs>();
  for (const r of recs) recsByRun.set(r.runId, [...(recsByRun.get(r.runId) ?? []), r]);
  const outcomeRuns: RunOutcomeInput[] = runs.map((run) => ({
    id: run.id,
    nowWeek: run.nowWeek,
    createdAt: run.createdAt,
    recs: (recsByRun.get(run.id) ?? []).map((r) => ({
      skuId: r.skuId,
      status: r.status,
      forecast: (r.evaluation as Evaluation).demandBaseline ?? null,
      firstDecisionAt: firstDecisionAt.get(r.id) ?? null,
    })),
  }));

  // "Cover now" comes from the latest run.
  const latestRun = runs[0];
  const latestRecs = latestRun ? (recsByRun.get(latestRun.id) ?? []) : [];
  const latestCover: CoverLookup = new Map(
    latestRecs.map((r) => {
      const e = r.evaluation as Evaluation;
      return [r.skuId, { cover: e.weeksOfCover, stockout: e.stockoutThresholdWeeks, overstock: e.overstockThresholdWeeks }];
    }),
  );

  const latestSalesWeek = latestSales?.week ?? null;
  const priceBySku = new Map(skus.map((s) => [s.skuId, s.unitPrice]));
  const exposure = rupeeExposure(
    latestRecs.map((r) => {
      const e = r.evaluation as Evaluation;
      const ready =
        ["APPROVED", "EDITED"].includes(r.status) && (r.finalQuantity ?? 0) > 0 && isReadyToSend(r)
          ? (r.finalQuantity ?? 0)
          : 0;
      return {
        unitPrice: priceBySku.get(r.skuId) ?? null,
        unitsOnHand: e.unitsOnHand,
        flag: r.flag,
        overstockLimitUnits:
          e.demandBaseline != null ? e.overstockThresholdWeeks * e.demandBaseline : null,
        readyOrderQty: ready,
      };
    }),
  );

  return {
    latestSalesWeek,
    latestRun: latestRun ?? null,
    summary: outcomeSummary(outcomeRuns, sales, latestSalesWeek, latestCover),
    trend: runTrend(outcomeRuns, sales, latestSalesWeek),
    exposure,
    figures,
    stockHistory: snapshots.map((s) => ({ at: s.at, units: Number(s.units ?? 0) })),
  };
}

export interface FiguresInput {
  quarter: string;
  baselineLoss: number | null;
  targetLoss: number | null;
  actualLoss: number | null;
  note: string | null;
}

/** Returns an error message, or null if the input is acceptable. */
export function validateFigures(f: FiguresInput): string | null {
  if (!isValidQuarter(f.quarter)) return "Quarter must look like 2026-Q3.";
  const values = [f.baselineLoss, f.targetLoss, f.actualLoss];
  if (values.every((v) => v == null)) return "Enter at least one figure.";
  if (values.some((v) => v != null && (!Number.isFinite(v) || v < 0))) return "Figures must be ₹ amounts of 0 or more.";
  return null;
}

/** Saves one quarter's entered figures and logs the change alongside the settings changes. */
export async function saveQuarterlyFigures(db: Db, f: FiguresInput, user: { username: string; id: number }) {
  const error = validateFigures(f);
  if (error) return { ok: false as const, error };
  const [old] = await db.select().from(schema.quarterlyFigures).where(eq(schema.quarterlyFigures.quarter, f.quarter));
  const values = {
    baselineLoss: f.baselineLoss,
    targetLoss: f.targetLoss,
    actualLoss: f.actualLoss,
    note: f.note,
    enteredBy: user.username,
    userId: user.id,
    enteredAt: new Date(),
  };
  const describe = (x: Pick<FiguresInput, "baselineLoss" | "targetLoss" | "actualLoss"> | undefined) =>
    x ? `baseline ${x.baselineLoss ?? "—"}, target ${x.targetLoss ?? "—"}, actual ${x.actualLoss ?? "—"}` : null;
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.quarterlyFigures)
      .values({ quarter: f.quarter, ...values })
      .onConflictDoUpdate({ target: schema.quarterlyFigures.quarter, set: values });
    await tx.insert(schema.settingsLog).values({
      area: "figures",
      key: f.quarter,
      oldValue: describe(old),
      newValue: describe(f)!,
      changedBy: user.username,
      userId: user.id,
      note: f.note,
    });
  });
  return { ok: true as const };
}

