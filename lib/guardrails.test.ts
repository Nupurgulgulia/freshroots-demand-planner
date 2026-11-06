// Phase 2 guardrails on a throwaway in-memory database: quantity cap + confirmation, and the AI call cap.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiMonthlyCap, usageMonth } from "./ai/usage";
import { exceedsQuantityCap, isReadyToSend } from "./review";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

const { closeDb, getDb, schema } = await import("@/lib/db");
const { confirmLargeQuantity, getApprovedOrders, reviewRecommendation } = await import("./review");
const { getAiUsage, reserveAiCall } = await import("./ai/usage");

let runId = 0;
const recIds: number[] = [];

beforeAll(async () => {
  const db = await getDb();
  await db.insert(schema.skus).values([
    { skuId: "S1", name: "Rice", category: "Staple", perishability: "Low", standardReorderQty: 100, unitOfMeasure: "Units", distributorId: "D1" },
  ]);
  const [run] = await db.insert(schema.runs).values({ nowWeek: "2026-W42", thresholds: {}, triggeredBy: "test" }).returning();
  runId = run.id;
  for (let i = 0; i < 2; i++) {
    const [rec] = await db
      .insert(schema.recommendations)
      .values({ runId, skuId: "S1", flag: "STOCKOUT", action: "REORDER", quantity: 100, isException: false, rulesFired: [], exceptionReasons: [], evaluation: {}, reason: "t" })
      .returning();
    recIds.push(rec.id);
  }
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("quantity cap", () => {
  it("compares the final quantity with the multiple of the standard quantity", () => {
    expect(exceedsQuantityCap(300, 100, 3)).toBe(false);
    expect(exceedsQuantityCap(301, 100, 3)).toBe(true);
    expect(exceedsQuantityCap(0, 100, 3)).toBe(false);
    expect(exceedsQuantityCap(null, 100, 3)).toBe(false);
    expect(exceedsQuantityCap(50, null, 3)).toBe(true); // no standard to compare with
    expect(isReadyToSend({ needsConfirmation: true, confirmedAt: null })).toBe(false);
    expect(isReadyToSend({ needsConfirmation: true, confirmedAt: new Date() })).toBe(true);
    expect(isReadyToSend({ needsConfirmation: false, confirmedAt: null })).toBe(true);
  });

  it("holds an edited quantity above 3× standard until procurement confirms, and logs the confirmation", async () => {
    const db = await getDb();
    const ok = await reviewRecommendation(db, { recommendationId: recIds[0], decision: "APPROVE", reviewer: "p" });
    expect(ok).toMatchObject({ ok: true, needsConfirmation: false });

    const big = await reviewRecommendation(db, { recommendationId: recIds[1], decision: "EDIT", reviewer: "p", quantity: 450, note: "festival" });
    expect(big).toMatchObject({ ok: true, needsConfirmation: true });
    let lines = await getApprovedOrders(db, runId);
    expect(lines.filter(isReadyToSend).map((l) => l.recommendationId)).toEqual([recIds[0]]);

    expect((await confirmLargeQuantity(db, { recommendationId: recIds[0], user: "proc", userId: null })).ok).toBe(false);
    expect((await confirmLargeQuantity(db, { recommendationId: recIds[1], user: "proc", userId: null })).ok).toBe(true);
    expect((await confirmLargeQuantity(db, { recommendationId: recIds[1], user: "proc", userId: null })).ok).toBe(false);
    lines = await getApprovedOrders(db, runId);
    expect(lines.every(isReadyToSend)).toBe(true);

    const audit = await db.select().from(schema.reviewAudit);
    expect(audit.map((a) => a.decision)).toContain("CONFIRMED");
  });

  it("needs a fresh confirmation after the decision changes", async () => {
    const db = await getDb();
    await reviewRecommendation(db, { recommendationId: recIds[1], decision: "EDIT", reviewer: "p", quantity: 500, note: "more" });
    const lines = await getApprovedOrders(db, runId);
    expect(lines.find((l) => l.recommendationId === recIds[1])).toMatchObject({ needsConfirmation: true, confirmedAt: null });
  });
});

describe("AI monthly call cap", () => {
  it("reads AI_MONTHLY_CALL_CAP with a default of 500 and counts months in India time", () => {
    expect(aiMonthlyCap({})).toBe(500);
    expect(aiMonthlyCap({ AI_MONTHLY_CALL_CAP: "20" })).toBe(20);
    expect(aiMonthlyCap({ AI_MONTHLY_CALL_CAP: "lots" })).toBe(500);
    expect(usageMonth(new Date("2026-11-30T19:00:00Z"))).toBe("2026-12"); // 00:30 on 1 Dec in IST
  });

  it("allows calls up to the cap and then refuses", async () => {
    process.env.AI_MONTHLY_CALL_CAP = "2";
    const db = await getDb();
    const now = new Date("2026-11-10T10:00:00Z");
    expect(await reserveAiCall(db, now)).toBe(true);
    expect(await reserveAiCall(db, now)).toBe(true);
    expect(await reserveAiCall(db, now)).toBe(false);
    expect(await getAiUsage(db, now)).toMatchObject({ calls: 2, cap: 2, capReached: true, remaining: 0 });
    // A new month starts again.
    expect(await reserveAiCall(db, new Date("2026-12-02T10:00:00Z"))).toBe(true);
    delete process.env.AI_MONTHLY_CALL_CAP;
  });
});
