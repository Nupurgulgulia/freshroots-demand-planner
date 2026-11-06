// Generates Gemini explanations for recommendations and caches them in the database.

import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import type { Evaluation, Thresholds } from "@/lib/rules/engine";
import { buildFacts, hashFacts } from "./facts";
import { explainWithGemini, geminiModel } from "./gemini";
import { capReachedMessage, getAiUsage, reserveAiCall } from "./usage";

/**
 * Explains one recommendation. Reuses the cached text unless `force` is set or
 * the inputs changed. Failures are stored too, so the UI can show them.
 */
export async function explainRecommendation(db: Db, recommendationId: number, force = false) {
  const [row] = await db
    .select({ rec: schema.recommendations, sku: schema.skus, run: schema.runs, ai: schema.aiExplanations })
    .from(schema.recommendations)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.recommendations.runId))
    .leftJoin(schema.skus, eq(schema.skus.skuId, schema.recommendations.skuId))
    .leftJoin(schema.aiExplanations, eq(schema.aiExplanations.recommendationId, schema.recommendations.id))
    .where(eq(schema.recommendations.id, recommendationId));
  if (!row) throw new Error(`Recommendation ${recommendationId} not found.`);

  const model = geminiModel();
  const facts = buildFacts(
    row.rec.evaluation as Evaluation,
    { category: row.sku?.category ?? "Unknown", standardReorderQty: row.sku?.standardReorderQty ?? 0 },
    row.run.thresholds as Thresholds,
  );
  const inputHash = hashFacts(facts, model);
  if (!force && row.ai && row.ai.inputHash === inputHash && !row.ai.error) return row.ai;

  // Spend cap: every real Gemini call is counted; cached text above costs nothing.
  if (!(await reserveAiCall(db))) {
    const usage = await getAiUsage(db);
    return { ...(row.ai ?? {}), capReached: true as const, error: capReachedMessage(usage.cap, usage.resumes) };
  }

  let values: { reason: string | null; brief: string | null; error: string | null };
  try {
    const out = await explainWithGemini(facts);
    values = { reason: out.reason, brief: out.brief, error: null };
  } catch (err) {
    // Keep any earlier good text; record why this attempt failed.
    values = {
      reason: row.ai?.reason ?? null,
      brief: row.ai?.brief ?? null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const record = { recommendationId, model, inputHash, createdAt: new Date(), ...values };
  await db
    .insert(schema.aiExplanations)
    .values(record)
    .onConflictDoUpdate({ target: schema.aiExplanations.recommendationId, set: record });
  return record;
}

/** Explains every actionable recommendation (and every exception) in a run, a few at a time. */
export async function explainRun(db: Db, runId: number, force = false) {
  const recs = await db
    .select({ id: schema.recommendations.id, action: schema.recommendations.action })
    .from(schema.recommendations)
    .where(eq(schema.recommendations.runId, runId));
  const targets = recs.filter((r) => r.action !== "NONE").map((r) => r.id);

  let failed = 0;
  let skippedForCap = 0;
  const queue = [...targets];
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const result = await explainRecommendation(db, id, force);
      if ("capReached" in result && result.capReached) {
        // Stop asking once the monthly cap is hit; count what was left undone.
        skippedForCap += 1 + queue.length;
        queue.length = 0;
      } else if (result.error) failed++;
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  return { total: targets.length, failed, skippedForCap };
}
