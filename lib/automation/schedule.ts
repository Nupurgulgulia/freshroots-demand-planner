// When the scheduled job runs and whether the data is fresh enough. Pure, so it is unit-tested.
//
// Vercel's Hobby plan allows one cron run a day, so the job is called daily at 00:30 UTC (06:00 IST)
// and only recalculates on Mondays and Thursdays (India time). Other days it only sends reminders.

import { dateToIsoWeek, weeksEndingAt } from "@/lib/rules/weeks";

export const RUN_DAYS_IST = [1, 4]; // Monday, Thursday (0 = Sunday)
export const REVIEW_REMINDER_DAYS = 2;

/** Today's date and weekday in India. */
export function istToday(now: Date) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now); // YYYY-MM-DD
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return { date, weekday };
}

export const isRunDay = (now: Date) => RUN_DAYS_IST.includes(istToday(now).weekday);

export function freshnessLimits(env: Record<string, string | undefined> = process.env) {
  const int = (v: string | undefined, d: number) => (v && Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return {
    /** How many weeks the latest sales week may lag behind the last complete week (IST). */
    salesWeeksBehind: int(env.STALE_SALES_WEEKS, 1),
    /** How many days old the latest stock snapshot may be. */
    stockDays: int(env.STALE_STOCK_DAYS, 10),
  };
}

/**
 * Is the data fresh enough to recalculate? "Last complete week" is the ISO week before today's (IST).
 * Returns the problems found; an empty list means fresh.
 */
export function checkFreshness(
  data: { latestSalesWeek: string | null; latestStockDate: string | null },
  now: Date,
  limits = freshnessLimits(),
): string[] {
  const { date } = istToday(now);
  const thisWeek = dateToIsoWeek(new Date(`${date}T00:00:00Z`));
  const lastComplete = weeksEndingAt(thisWeek, 2)[0];
  const oldestAllowedWeek = weeksEndingAt(lastComplete, limits.salesWeeksBehind + 1)[0];
  const problems: string[] = [];

  if (!data.latestSalesWeek) problems.push("There is no sales data.");
  else if (data.latestSalesWeek < oldestAllowedWeek) {
    problems.push(
      `Sales data ends at ${data.latestSalesWeek}; the last complete week is ${lastComplete} (allowed lag: ${limits.salesWeeksBehind} week${limits.salesWeeksBehind === 1 ? "" : "s"}).`,
    );
  }

  if (!data.latestStockDate) problems.push("There is no stock data.");
  else {
    const ageDays = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${data.latestStockDate}T00:00:00Z`)) / 86_400_000);
    if (ageDays > limits.stockDays) {
      problems.push(`Stock data is from ${data.latestStockDate}, ${ageDays} days ago (allowed: ${limits.stockDays} days).`);
    }
  }
  return problems;
}

/** Recommendations still pending more than REVIEW_REMINDER_DAYS after their run was created. */
export function isReviewOverdue(runCreatedAt: Date, now: Date) {
  return now.getTime() - runCreatedAt.getTime() > REVIEW_REMINDER_DAYS * 86_400_000;
}
