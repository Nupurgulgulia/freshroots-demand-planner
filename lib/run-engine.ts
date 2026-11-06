// Loads everything from the database, runs the rules, and stores a new run.

import { and, count, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { evaluateAll, type Evaluation } from "@/lib/rules/engine";
import { buildEngineInputs } from "@/lib/rules/inputs";
import { getThresholds } from "@/lib/settings";

export async function runEngine(db: Db, triggeredBy: string, userId: number | null = null) {
  const [skus, distributors, sales, inventory, calendar, openPurchaseOrders, thresholds] = await Promise.all([
    db.select().from(schema.skus).orderBy(schema.skus.skuId),
    db.select().from(schema.distributors),
    db.select().from(schema.weeklySales),
    db.select().from(schema.inventory),
    db.select().from(schema.festivalCalendar),
    db.select().from(schema.openPurchaseOrders),
    getThresholds(db),
  ]);
  if (skus.length === 0) throw new Error("No SKUs loaded. Upload sku_master.csv first.");

  const inputs = buildEngineInputs({ skus, distributors, sales, inventory, calendar, openPurchaseOrders });
  if (!inputs.nowWeek) throw new Error("No sales loaded. Upload weekly_sales.csv first.");

  const results = evaluateAll(inputs.skus, {
    nowWeek: inputs.nowWeek,
    festivalCalendar: inputs.festivalCalendar,
    thresholds,
  });

  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(schema.runs)
      .values({ nowWeek: inputs.nowWeek!, thresholds, triggeredBy, userId })
      .returning();
    await tx.insert(schema.recommendations).values(
      results.map((e) => ({
        runId: run.id,
        skuId: e.skuId,
        flag: e.flag,
        action: e.action,
        quantity: e.quantity,
        isException: e.isException,
        rulesFired: e.rulesFired,
        exceptionReasons: e.exceptionReasons,
        evaluation: e,
        reason: e.reason,
        // Nothing to decide when the engine recommends no action.
        status: e.action === "NONE" ? "NO_ACTION" : "PENDING",
      })),
    );
    return run;
  });
}

export async function getLatestRun(db: Db) {
  const [run] = await db.select().from(schema.runs).orderBy(desc(schema.runs.id)).limit(1);
  return run ?? null;
}

/** How many recommendations of the latest run still wait for a decision. */
export async function getPendingCount(db: Db) {
  const run = await getLatestRun(db);
  if (!run) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(schema.recommendations)
    .where(and(eq(schema.recommendations.runId, run.id), eq(schema.recommendations.status, "PENDING")));
  return row?.n ?? 0;
}

/** Recommendations of a run joined with SKU names and cached AI text. */
export async function getRunRecommendations(db: Db, runId: number) {
  const rows = await db
    .select({
      rec: schema.recommendations,
      sku: schema.skus,
      ai: schema.aiExplanations,
    })
    .from(schema.recommendations)
    .leftJoin(schema.skus, eq(schema.skus.skuId, schema.recommendations.skuId))
    .leftJoin(schema.aiExplanations, eq(schema.aiExplanations.recommendationId, schema.recommendations.id))
    .where(eq(schema.recommendations.runId, runId))
    .orderBy(schema.recommendations.skuId);
  return rows.map((r) => ({ ...r, evaluation: r.rec.evaluation as Evaluation }));
}
