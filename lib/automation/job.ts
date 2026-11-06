// The scheduled job (Vercel Cron, or "Run now" in Settings). Order:
//   1. Mon/Thu only (India time) for a cron call; other days only send review reminders.
//   2. Once per day: a second cron call the same day doesn't recalculate again.
//   3. Sync open POs from Zoho if it's connected (a failure is noted, the job carries on).
//   4. Freshness: if sales or stock data is too old, skip and alert planners and viewers.
//   5. Recalculate, then generate AI text for exceptions and action SKUs within the monthly cap.
//   6. Email planners a run summary. Every day: remind planners of reviews pending over 2 days.

import { and, desc, eq, gte, max } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { explainRun } from "@/lib/ai/explain";
import { geminiConfigured } from "@/lib/ai/gemini";
import { getAiUsage } from "@/lib/ai/usage";
import { getLatestRun, getRunRecommendations, runEngine } from "@/lib/run-engine";
import { ACTION_LABELS, FLAG_LABELS, type Action, type Flag } from "@/lib/rules/engine";
import { zohoConfig } from "@/lib/zoho/inventory";
import { syncOpenPosFromZoho } from "@/lib/zoho/sync";
import { appUrl, deliver, recipientsFor, resendSender, type SendEmail } from "./email";
import { checkFreshness, freshnessLimits, isReviewOverdue, isRunDay, istToday, REVIEW_REMINDER_DAYS } from "./schedule";

const ACTOR = { username: "scheduler", id: null };

export interface JobOptions {
  trigger: "cron" | "manual";
  triggeredBy?: string;
  now?: Date;
  sendEmail?: SendEmail;
  /** Tests switch these off. */
  syncZoho?: boolean;
  explain?: boolean;
}

/** Starts of today in India, as a UTC Date (for "already ran today" checks). */
function istDayStart(now: Date) {
  return new Date(`${istToday(now).date}T00:00:00+05:30`);
}

export async function runScheduledJob(db: Db, options: JobOptions) {
  const now = options.now ?? new Date();
  const send = options.sendEmail ?? resendSender;
  const steps: string[] = [];
  const [job] = await db
    .insert(schema.jobRuns)
    .values({ trigger: options.trigger, triggeredBy: options.triggeredBy ?? "scheduler", startedAt: now })
    .returning();
  const finish = async (outcome: string, message: string, runId: number | null = null) => {
    await db
      .update(schema.jobRuns)
      .set({ outcome, message, runId, steps, finishedAt: new Date() })
      .where(eq(schema.jobRuns.id, job.id));
    return { jobId: job.id, outcome, message, runId, steps };
  };

  try {
    // Reminders go out every day the job is called (at most once a day).
    steps.push(await sendReviewReminders(db, job.id, now, send));

    if (options.trigger === "cron" && !isRunDay(now)) {
      return await finish("skipped_day", `Not a run day (${istToday(now).date}); runs on Mondays and Thursdays.`);
    }
    if (options.trigger === "cron") {
      const [already] = await db
        .select({ id: schema.jobRuns.id })
        .from(schema.jobRuns)
        .where(and(eq(schema.jobRuns.outcome, "ran"), gte(schema.jobRuns.startedAt, istDayStart(now))))
        .limit(1);
      if (already) return await finish("skipped_already_ran", `Already recalculated today (job #${already.id}).`);
    }

    const config = zohoConfig();
    if (config && options.syncZoho !== false) {
      try {
        const s = await syncOpenPosFromZoho(db, config, ACTOR);
        steps.push(`Synced ${s.poCount} open POs (${s.lineCount} lines) from Zoho.`);
      } catch (err) {
        steps.push(`Zoho sync failed, used the open POs already loaded: ${(err as Error).message}`);
      }
    } else {
      steps.push("Zoho not connected: open POs not synced.");
    }

    const [[sales], [stock]] = await Promise.all([
      db.select({ week: max(schema.weeklySales.week) }).from(schema.weeklySales),
      db.select({ date: max(schema.inventory.asOfDate) }).from(schema.inventory),
    ]);
    const problems = checkFreshness({ latestSalesWeek: sales?.week ?? null, latestStockDate: stock?.date ?? null }, now);
    if (problems.length) {
      steps.push(`Data too old: ${problems.join(" ")}`);
      const to = await recipientsFor(db, ["planner", "viewer"]);
      const limits = freshnessLimits();
      const r = await deliver(
        db,
        {
          kind: "stale_data",
          to,
          subject: "Freshroots: scheduled run skipped (data too old)",
          text: [
            `The scheduled recalculation on ${istToday(now).date} was skipped because the data is out of date:`,
            ...problems.map((p) => `- ${p}`),
            "",
            `Upload fresh weekly_sales.csv and current_inventory.csv, then recalculate: ${appUrl()}/upload`,
            `(Limits: sales may lag ${limits.salesWeeksBehind} week(s); stock may be ${limits.stockDays} days old.)`,
          ].join("\n"),
        },
        job.id,
        send,
      );
      steps.push(`Stale-data alert: ${r.status} (${to.length} recipients).`);
      return await finish("skipped_stale", problems.join(" "));
    }

    const run = await runEngine(db, ACTOR.username, ACTOR.id);
    steps.push(`Recalculated: run #${run.id} for ${run.nowWeek}.`);

    if (options.explain !== false && geminiConfigured()) {
      const usage = await getAiUsage(db, now);
      if (usage.capReached) steps.push(`AI text skipped: monthly limit reached (${usage.calls}/${usage.cap}).`);
      else {
        try {
          const ai = await explainRun(db, run.id);
          steps.push(
            `AI text: ${ai.total - ai.failed - ai.skippedForCap} of ${ai.total} explained` +
              (ai.skippedForCap ? `, ${ai.skippedForCap} left for the monthly limit` : "") +
              (ai.failed ? `, ${ai.failed} failed` : "") +
              ".",
          );
        } catch (err) {
          steps.push(`AI text failed: ${(err as Error).message}`);
        }
      }
    } else {
      steps.push("AI text not generated (GEMINI_API_KEY not set or switched off).");
    }

    const recs = await getRunRecommendations(db, run.id);
    const count = (f: Flag) => recs.filter((r) => r.rec.flag === f).length;
    const units = recs.reduce((a, r) => a + (r.rec.action === "REORDER" ? (r.rec.quantity ?? 0) : 0), 0);
    const actionable = recs.filter((r) => r.rec.action !== "NONE");
    const top = actionable
      .sort((a, b) => Number(b.rec.isException) - Number(a.rec.isException))
      .slice(0, 8)
      .map(
        (r) =>
          `- ${r.sku?.name ?? r.rec.skuId} (${r.rec.skuId}): ${FLAG_LABELS[r.rec.flag as Flag]}, ${ACTION_LABELS[r.rec.action as Action]}${r.rec.quantity ? ` ${r.rec.quantity}` : ""}`,
      );
    const planners = await recipientsFor(db, ["planner"]);
    const r = await deliver(
      db,
      {
        kind: "run_summary",
        to: planners,
        subject: `Freshroots: ${actionable.length} recommendations to review for ${run.nowWeek}`,
        text: [
          `Run #${run.id} for ${run.nowWeek} is ready.`,
          `Exceptions: ${count("EXCEPTION")} · Stockout risk: ${count("STOCKOUT")} · Overstock risk: ${count("OVERSTOCK")} · High demand: ${count("HIGH_DEMAND")} · No action: ${count("NO_ACTION")}`,
          `Units to order before review: ${units}`,
          "",
          ...top,
          actionable.length > top.length ? `- …and ${actionable.length - top.length} more` : "",
          "",
          `Review them: ${appUrl()}/review`,
        ]
          .filter((l, i, a) => l !== "" || a[i - 1] !== "")
          .join("\n"),
      },
      job.id,
      send,
    );
    steps.push(`Run summary: ${r.status} (${planners.length} planners).`);
    return await finish("ran", `Run #${run.id} for ${run.nowWeek}.`, run.id);
  } catch (err) {
    steps.push(`Failed: ${(err as Error).message}`);
    return await finish("failed", (err as Error).message);
  }
}

/** Reminds planners about recommendations pending more than 2 days. At most one reminder a day. */
async function sendReviewReminders(db: Db, jobId: number, now: Date, send: SendEmail): Promise<string> {
  const run = await getLatestRun(db);
  if (!run || !isReviewOverdue(run.createdAt, now)) return "Reminders: nothing overdue.";
  const pending = (await getRunRecommendations(db, run.id)).filter((r) => r.rec.status === "PENDING");
  if (pending.length === 0) return "Reminders: nothing overdue.";
  const [sentToday] = await db
    .select({ id: schema.emailLog.id })
    .from(schema.emailLog)
    .where(and(eq(schema.emailLog.kind, "review_reminder"), gte(schema.emailLog.createdAt, istDayStart(now))))
    .orderBy(desc(schema.emailLog.id))
    .limit(1);
  if (sentToday) return "Reminders: already sent today.";

  const days = Math.floor((now.getTime() - run.createdAt.getTime()) / 86_400_000);
  const to = await recipientsFor(db, ["planner"]);
  const r = await deliver(
    db,
    {
      kind: "review_reminder",
      to,
      subject: `Freshroots: ${pending.length} recommendations waiting more than ${REVIEW_REMINDER_DAYS} days`,
      text: [
        `${pending.length} recommendations from run #${run.id} (${run.nowWeek}) have been waiting ${days} days for a decision:`,
        ...pending.slice(0, 10).map((p) => `- ${p.sku?.name ?? p.rec.skuId} (${p.rec.skuId}): ${ACTION_LABELS[p.rec.action as Action]}${p.rec.quantity ? ` ${p.rec.quantity}` : ""}`),
        pending.length > 10 ? `- …and ${pending.length - 10} more` : "",
        "",
        `Review them: ${appUrl()}/review`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
    jobId,
    send,
  );
  return `Reminder for ${pending.length} overdue reviews: ${r.status} (${to.length} planners).`;
}

export async function getRecentJobs(db: Db, limit = 10) {
  return db.select().from(schema.jobRuns).orderBy(desc(schema.jobRuns.id)).limit(limit);
}

export async function getRecentEmails(db: Db, limit = 10) {
  return db.select().from(schema.emailLog).orderBy(desc(schema.emailLog.id)).limit(limit);
}
