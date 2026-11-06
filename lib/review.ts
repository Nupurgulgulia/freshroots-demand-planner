// Approve / edit / reject decisions, each written to the audit table.

import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { getThresholds } from "@/lib/settings";

export type Decision = "APPROVE" | "EDIT" | "REJECT";

export interface ReviewInput {
  recommendationId: number;
  decision: Decision;
  reviewer: string;
  /** The signed-in user who made the decision. */
  userId?: number | null;
  quantity?: number | null;
  note?: string | null;
}

const STATUS: Record<Decision, string> = { APPROVE: "APPROVED", EDIT: "EDITED", REJECT: "REJECTED" };

/**
 * Quantity cap: an order quantity above multiple × the standard reorder quantity needs a procurement
 * confirmation. With no standard quantity to compare against, any order needs one.
 */
export function exceedsQuantityCap(finalQuantity: number | null, standardQty: number | null, multiple: number): boolean {
  if (finalQuantity == null || finalQuantity <= 0) return false;
  if (standardQty == null || standardQty <= 0) return true;
  return finalQuantity > multiple * standardQty;
}

/** An approved line can be sent (CSV export, later Zoho) once any large quantity is confirmed. */
export const isReadyToSend = (line: { needsConfirmation: boolean; confirmedAt: Date | null }) =>
  !line.needsConfirmation || line.confirmedAt != null;

/** Returns an error message, or null if the input is acceptable. */
export function validateReview(input: ReviewInput): string | null {
  if (!input.reviewer?.trim()) return "Sign in to record a decision.";
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
  const [sku] = await db
    .select({ std: schema.skus.standardReorderQty })
    .from(schema.skus)
    .where(eq(schema.skus.skuId, rec.skuId));
  const { maxQtyMultiple } = await getThresholds(db);
  const needsConfirmation = exceedsQuantityCap(finalQuantity, sku?.std ?? null, maxQtyMultiple);
  const reviewer = input.reviewer.trim();
  const note = input.note?.trim() || null;
  const status = STATUS[input.decision];

  await db.transaction(async (tx) => {
    await tx
      .update(schema.recommendations)
      .set({
        status,
        finalQuantity,
        reviewedBy: reviewer,
        reviewedByUserId: input.userId ?? null,
        reviewedAt: new Date(),
        reviewNote: note,
        // A new decision always needs a fresh confirmation.
        needsConfirmation,
        confirmedBy: null,
        confirmedByUserId: null,
        confirmedAt: null,
      })
      .where(eq(schema.recommendations.id, rec.id));
    await tx.insert(schema.reviewAudit).values({
      recommendationId: rec.id,
      runId: rec.runId,
      skuId: rec.skuId,
      decision: status,
      reviewer,
      userId: input.userId ?? null,
      originalAction: rec.action,
      originalQuantity: rec.quantity,
      finalQuantity,
      note,
    });
  });
  return { ok: true as const, status, needsConfirmation };
}

/** Procurement confirms a large approved quantity so it counts as ready to send. Logged in the audit table. */
export async function confirmLargeQuantity(
  db: Db,
  input: { recommendationId: number; user: string; userId: number | null; note?: string | null },
) {
  const [rec] = await db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.id, input.recommendationId));
  if (!rec) return { ok: false as const, error: "Recommendation not found." };
  if (!["APPROVED", "EDITED"].includes(rec.status) || !rec.needsConfirmation) {
    return { ok: false as const, error: "This line doesn't need a confirmation." };
  }
  if (rec.confirmedAt) return { ok: false as const, error: `Already confirmed by ${rec.confirmedBy}.` };

  const note = input.note?.trim() || null;
  await db.transaction(async (tx) => {
    await tx
      .update(schema.recommendations)
      .set({ confirmedBy: input.user, confirmedByUserId: input.userId, confirmedAt: new Date() })
      .where(eq(schema.recommendations.id, rec.id));
    await tx.insert(schema.reviewAudit).values({
      recommendationId: rec.id,
      runId: rec.runId,
      skuId: rec.skuId,
      decision: "CONFIRMED",
      reviewer: input.user,
      userId: input.userId,
      originalAction: rec.action,
      originalQuantity: rec.quantity,
      finalQuantity: rec.finalQuantity,
      note: note ?? "Large quantity confirmed by procurement.",
    });
  });
  return { ok: true as const };
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
      standardReorderQty: schema.skus.standardReorderQty,
      needsConfirmation: schema.recommendations.needsConfirmation,
      confirmedBy: schema.recommendations.confirmedBy,
      confirmedAt: schema.recommendations.confirmedAt,
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
