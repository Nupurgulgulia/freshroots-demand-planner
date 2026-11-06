// Database-level checks of sign-in and lockout, on a throwaway in-memory PGlite database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

const { closeDb, getDb, schema } = await import("@/lib/db");
const { attemptLogin, changePassword, getLockStatus, setUserActive, setUserRole, upsertUser } = await import("./users");

const PW = "correct horse 42";

beforeAll(async () => {
  const db = await getDb();
  expect((await upsertUser(db, { username: "Raghav", role: "planner", email: "r@freshroots.in", password: PW })).ok).toBe(true);
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("sign-in against the database", () => {
  it("stores only a hash, lower-cases the username, and signs in", async () => {
    const db = await getDb();
    const [row] = await db.select().from(schema.users);
    expect(row.username).toBe("raghav");
    expect(row.passwordHash).not.toContain(PW);
    const result = await attemptLogin(db, "RAGHAV", PW);
    expect(result.ok && result.user.role).toBe("planner");
  });

  it("refuses duplicates unless --reset", async () => {
    const db = await getDb();
    const again = await upsertUser(db, { username: "raghav", role: "planner", email: "r@freshroots.in", password: PW });
    expect(again.ok).toBe(false);
  });

  it("locks the username after 5 wrong passwords, even for the right one, then unlocks after 15 minutes", async () => {
    const db = await getDb();
    const t0 = new Date("2026-11-06T10:00:00Z");
    for (let i = 0; i < 4; i++) expect((await attemptLogin(db, "raghav", "wrong password", t0)).ok).toBe(false);
    expect((await getLockStatus(db, "raghav", t0)).locked).toBe(false);
    expect(await attemptLogin(db, "raghav", "wrong password", t0)).toEqual({ ok: false, reason: "locked" });
    expect(await attemptLogin(db, "raghav", PW, t0)).toEqual({ ok: false, reason: "locked" });

    const later = new Date(t0.getTime() + 15 * 60_000 + 1000);
    expect((await attemptLogin(db, "raghav", PW, later)).ok).toBe(true);
    expect((await getLockStatus(db, "raghav", later)).locked).toBe(false);
  });

  it("records review decisions against the signed-in user's account", async () => {
    const db = await getDb();
    const { reviewRecommendation } = await import("./review");
    const [user] = await db.select().from(schema.users);
    const [run] = await db.insert(schema.runs).values({ nowWeek: "2026-W42", thresholds: {}, triggeredBy: "test" }).returning();
    const [rec] = await db
      .insert(schema.recommendations)
      .values({
        runId: run.id,
        skuId: "SKU001",
        flag: "STOCKOUT",
        action: "REORDER",
        quantity: 500,
        isException: false,
        rulesFired: [],
        exceptionReasons: [],
        evaluation: {},
        reason: "test",
      })
      .returning();
    const result = await reviewRecommendation(db, {
      recommendationId: rec.id,
      decision: "APPROVE",
      reviewer: user.username,
      userId: user.id,
    });
    expect(result.ok).toBe(true);
    const [audit] = await db.select().from(schema.reviewAudit);
    expect(audit).toMatchObject({ reviewer: "raghav", userId: user.id, decision: "APPROVED", finalQuantity: 500 });
    const [updated] = await db.select().from(schema.recommendations);
    expect(updated.reviewedByUserId).toBe(user.id);
  });

  it("changes only the role with setUserRole, keeping the password", async () => {
    const db = await getDb();
    expect(await setUserRole(db, "raghav", "admin")).toMatchObject({ ok: false });
    expect(await setUserRole(db, "nobody", "viewer")).toMatchObject({ ok: false });
    expect(await setUserRole(db, "Raghav", "procurement")).toEqual({ ok: true, previousRole: "planner" });
    const login = await attemptLogin(db, "raghav", PW);
    expect(login.ok && login.user.role).toBe("procurement");
    await setUserRole(db, "raghav", "planner");
  });

  it("blocks disabled users and supports changing a password", async () => {
    const db = await getDb();
    await setUserActive(db, "raghav", false);
    expect((await attemptLogin(db, "raghav", PW)).ok).toBe(false);
    await setUserActive(db, "raghav", true);

    const [row] = await db.select().from(schema.users);
    expect((await changePassword(db, row.id, "nope nope nope", "new password 99")).ok).toBe(false);
    expect((await changePassword(db, row.id, PW, "short")).ok).toBe(false);
    expect((await changePassword(db, row.id, PW, "new password 99")).ok).toBe(true);
    expect((await attemptLogin(db, "raghav", "new password 99")).ok).toBe(true);
  });
});
