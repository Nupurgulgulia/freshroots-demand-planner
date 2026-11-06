// Phase 5: schedule rules (pure) and the whole scheduled job on a throwaway in-memory database
// loaded with the sample CSVs. Emails go to a fake sender so nothing leaves the machine.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFreshness, isReviewOverdue, isRunDay, istToday } from "./schedule";
import type { Email, SendEmail } from "./email";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;
delete process.env.GEMINI_API_KEY;
delete process.env.ZOHO_CLIENT_ID;
delete process.env.RESEND_API_KEY;

const { closeDb, getDb, schema } = await import("@/lib/db");
const { importCsv } = await import("@/lib/data/load");
const { upsertUser } = await import("@/lib/users");
const { runScheduledJob } = await import("./job");
const { resendSender } = await import("./email");

const sent: Email[] = [];
const fakeSend: SendEmail = async (e) => {
  sent.push(e);
  return { status: "sent" };
};

beforeAll(async () => {
  const db = await getDb();
  for (const d of ["distributor_master", "sku_master", "calendar", "weekly_sales", "current_inventory"] as const) {
    const csv = readFileSync(path.join(process.cwd(), "data", `${d}.csv`), "utf8");
    expect((await importCsv(db, d, csv, `${d}.csv`, "test")).ok).toBe(true);
  }
  for (const [username, role] of [["raghav", "planner"], ["deepa", "viewer"], ["proc", "procurement"]] as const) {
    await upsertUser(db, { username, role, email: `${username}@freshroots.in`, password: "test password 1" });
  }
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("schedule rules", () => {
  it("works out the day in India time", () => {
    expect(istToday(new Date("2026-10-25T19:00:00Z"))).toEqual({ date: "2026-10-26", weekday: 1 }); // Mon 00:30 IST
    expect(isRunDay(new Date("2026-10-26T00:30:00Z"))).toBe(true); // Monday 06:00 IST
    expect(isRunDay(new Date("2026-10-29T00:30:00Z"))).toBe(true); // Thursday
    expect(isRunDay(new Date("2026-10-28T00:30:00Z"))).toBe(false); // Wednesday
  });

  it("calls data stale when sales lag more than a week or stock is over 10 days old", () => {
    const limits = { salesWeeksBehind: 1, stockDays: 10 };
    const monday = new Date("2026-10-26T01:00:00Z"); // this week W44, last complete W43
    expect(checkFreshness({ latestSalesWeek: "2026-W42", latestStockDate: "2026-10-19" }, monday, limits)).toEqual([]);
    const later = new Date("2026-11-09T01:00:00Z"); // last complete W45
    const problems = checkFreshness({ latestSalesWeek: "2026-W42", latestStockDate: "2026-10-19" }, later, limits);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/ends at 2026-W42; the last complete week is 2026-W45/);
    expect(problems[1]).toMatch(/21 days ago/);
    expect(checkFreshness({ latestSalesWeek: null, latestStockDate: null }, monday, limits)).toHaveLength(2);
  });

  it("flags reviews as overdue after 2 days", () => {
    const created = new Date("2026-10-26T01:00:00Z");
    expect(isReviewOverdue(created, new Date("2026-10-28T00:59:00Z"))).toBe(false);
    expect(isReviewOverdue(created, new Date("2026-10-28T01:01:00Z"))).toBe(true);
  });

  it("only logs emails when RESEND_API_KEY is not set", async () => {
    expect(await resendSender({ kind: "run_summary", to: ["a@b.in"], subject: "s", text: "t" })).toEqual({ status: "logged" });
  });
});

describe("the scheduled job", () => {
  // runScheduledJob takes the db as its first argument; bind it here.
  const run = async (now: string, trigger: "cron" | "manual" = "cron") => {
    const db = await getDb();
    return runScheduledJob(db, { trigger, now: new Date(now), sendEmail: fakeSend, syncZoho: false, explain: false });
  };

  it("does nothing but reminders on days other than Monday and Thursday", async () => {
    const r = await run("2026-10-28T00:30:00Z");
    expect(r.outcome).toBe("skipped_day");
    const db = await getDb();
    expect(await db.select().from(schema.runs)).toHaveLength(0);
  });

  it("skips a run on stale data and alerts planners and viewers", async () => {
    sent.length = 0;
    const r = await run("2026-11-09T00:30:00Z");
    expect(r.outcome).toBe("skipped_stale");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "stale_data" });
    expect(sent[0].to.sort()).toEqual(["deepa@freshroots.in", "raghav@freshroots.in"]);
    expect(sent[0].text).toMatch(/Upload fresh weekly_sales\.csv/);
  });

  it("recalculates on a Monday with fresh data and emails planners a summary", async () => {
    sent.length = 0;
    const r = await run("2026-10-26T00:45:00Z");
    expect(r.outcome).toBe("ran");
    expect(r.runId).not.toBeNull();
    const db = await getDb();
    const [latest] = await db.select().from(schema.runs);
    expect(latest).toMatchObject({ nowWeek: "2026-W42", triggeredBy: "scheduler" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "run_summary", to: ["raghav@freshroots.in"] });
    // Same expected result as the unit tests: 1 exception, 4 stockouts, 2 overstock.
    expect(sent[0].text).toMatch(/Exceptions: 1 · Stockout risk: 4 · Overstock risk: 2/);
    expect(sent[0].subject).toMatch(/7 recommendations to review for 2026-W42/);
    expect(sent[0].text).toMatch(/Units to order before review: 1820/);
    // The database stamps the run with the real clock; move it to the simulated Monday for later tests.
    await db.update(schema.runs).set({ createdAt: new Date("2026-10-26T00:45:00Z") });
  });

  it("doesn't recalculate twice on the same day", async () => {
    const r = await run("2026-10-26T01:20:00Z");
    expect(r.outcome).toBe("skipped_already_ran");
    const db = await getDb();
    expect(await db.select().from(schema.runs)).toHaveLength(1);
  });

  it("reminds planners once a day about reviews pending over 2 days", async () => {
    sent.length = 0;
    await run("2026-10-28T02:00:00Z"); // Wednesday, 2+ days after Monday's run
    expect(sent.map((e) => e.kind)).toEqual(["review_reminder"]);
    expect(sent[0].subject).toMatch(/7 recommendations waiting more than 2 days/);
    await run("2026-10-28T03:00:00Z"); // same day again: no second reminder
    expect(sent).toHaveLength(1);
    const db = await getDb();
    const log = await db.select().from(schema.emailLog);
    expect(log.map((l) => l.kind)).toEqual(["stale_data", "run_summary", "review_reminder"]);
  });

  it("'Run now' ignores the weekday rule but still checks freshness", async () => {
    const r = await run("2026-11-11T05:00:00Z", "manual"); // a Wednesday, stale data
    expect(r.outcome).toBe("skipped_stale");
  });
});

describe("the cron route", () => {
  it("refuses calls without the right CRON_SECRET", async () => {
    const { GET } = await import("@/app/api/cron/daily/route");
    delete process.env.CRON_SECRET;
    expect((await GET(new Request("http://x/api/cron/daily", { headers: { authorization: "Bearer anything" } }))).status).toBe(401);
    process.env.CRON_SECRET = "s3cret-value-for-test";
    expect((await GET(new Request("http://x/api/cron/daily"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/cron/daily", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    delete process.env.CRON_SECRET;
  });
});
