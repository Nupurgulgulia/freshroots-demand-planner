// Approve / edit / reject decisions, each written to the audit table.

import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";

export type Decision = "APPROVE" | "EDIT" | "REJECT";

export interface ReviewInput {
  recommendationId: number;
  decision: Decision;
  reviewer: string;
  quantity?: number | null;
  note?: string | null;
}

const STATUS: Record<Decision, string> = { APPROVE: "APPROVED", EDIT: "EDITED", REJECT: "REJECTED" };

/** Returns an error message, or null if the input is acceptable. */
export function validateReview(input: ReviewInput): string | null {
  if (!input.reviewer?.trim()) return "Enter your name.";
  if (input.decision === "EDIT") {
    const q = input.quantity;
    if (q == null || !Number.isInteger(q) || q < 0) return "Enter a whole-number quantity of 0 or more.";
    if (!input.note?.trim()) return "Add a note explaining the change.";
  }
  if (input.decision === "REJECT" && !input.note?.trim()) return "Add a note explaining the rejection.";
  return null;
}

export async function reviewRecommendation(db: Db, input: ReviewInput) {
  const error = validateReview(input);
  if (error) return { ok: false as const, error };

  const [rec] = await db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.id, input.recommendationId));
  if (!rec) return { ok: false as const, error: "Recommendation not found." };

  const finalQuantity =
    input.decision === "APPROVE" ? rec.quantity : input.decision === "EDIT" ? input.quantity! : null;
  const reviewer = input.reviewer.trim();
  const note = input.note?.trim() || null;
  const status = STATUS[input.decision];

  await db.transaction(async (tx) => {
    await tx
      .update(schema.recommendations)
      .set({ status, finalQuantity, reviewedBy: reviewer, reviewedAt: new Date(), reviewNote: note })
      .where(eq(schema.recommendations.id, rec.id));
    await tx.insert(schema.reviewAudit).values({
      recommendationId: rec.id,
      runId: rec.runId,
      skuId: rec.skuId,
      decision: status,
      reviewer,
      originalAction: rec.action,
      originalQuantity: rec.quantity,
      finalQuantity,
      note,
    });
  });
  return { ok: true as const, status };
}

export async function getAuditForSku(db: Db, skuId: string) {
  return db
    .select()
    .from(schema.reviewAudit)
    .where(eq(schema.reviewAudit.skuId, skuId))
    .orderBy(desc(schema.reviewAudit.id));
}

/** Approved (or edited) recommendations with a quantity to order, for one run. */
export async function getApprovedOrders(db: Db, runId: number) {
  return db
    .select({
      recommendationId: schema.recommendations.id,
      skuId: schema.recommendations.skuId,
      skuName: schema.skus.name,
      unitOfMeasure: schema.skus.unitOfMeasure,
      distributorId: schema.skus.distributorId,
      distributorName: schema.distributors.name,
      region: schema.distributors.region,
      recommendedQuantity: schema.recommendations.quantity,
      finalQuantity: schema.recommendations.finalQuantity,
      status: schema.recommendations.status,
      flag: schema.recommendations.flag,
      reviewedBy: schema.recommendations.reviewedBy,
      reviewedAt: schema.recommendations.reviewedAt,
      reviewNote: schema.recommendations.reviewNote,
    })
    .from(schema.recommendations)
    .leftJoin(schema.skus, eq(schema.skus.skuId, schema.recommendations.skuId))
    .leftJoin(schema.distributors, eq(schema.distributors.distributorId, schema.skus.distributorId))
    .where(
      and(
        eq(schema.recommendations.runId, runId),
        inArray(schema.recommendations.status, ["APPROVED", "EDITED"]),
        gt(schema.recommendations.finalQuantity, 0),
      ),
    )
    .orderBy(schema.skus.distributorId, schema.recommendations.skuId);
}
