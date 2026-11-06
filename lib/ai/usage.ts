// Monthly cap on Gemini calls (AI_MONTHLY_CALL_CAP, default 500), counted in the database.

import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";

export const DEFAULT_AI_MONTHLY_CALL_CAP = 500;

export function aiMonthlyCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env.AI_MONTHLY_CALL_CAP?.trim();
  if (!raw) return DEFAULT_AI_MONTHLY_CALL_CAP;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_AI_MONTHLY_CALL_CAP;
}

/** Calendar month in India time, e.g. "2026-11". */
export function usageMonth(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" })
    .format(now)
    .slice(0, 7);
}

/** The 1st of next month (IST), shown as when generation resumes. */
export function nextMonthLabel(now = new Date()): string {
  const [y, m] = usageMonth(now).split("-").map(Number);
  const next = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
  return next.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export async function getAiUsage(db: Db, now = new Date()) {
  const month = usageMonth(now);
  const cap = aiMonthlyCap();
  const [row] = await db.select().from(schema.aiUsage).where(eq(schema.aiUsage.month, month));
  const calls = row?.calls ?? 0;
  return { month, calls, cap, remaining: Math.max(0, cap - calls), capReached: calls >= cap, resumes: nextMonthLabel(now) };
}

/**
 * Reserves one Gemini call for this month. Returns false (and reserves nothing) once the cap is reached.
 * A single statement, so two people generating at once can't push past the cap.
 */
export async function reserveAiCall(db: Db, now = new Date()): Promise<boolean> {
  const cap = aiMonthlyCap();
  if (cap <= 0) return false;
  const rows = await db
    .insert(schema.aiUsage)
    .values({ month: usageMonth(now), calls: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.aiUsage.month,
      set: { calls: sql`${schema.aiUsage.calls} + 1`, updatedAt: now },
      setWhere: sql`${schema.aiUsage.calls} < ${cap}`,
    })
    .returning({ calls: schema.aiUsage.calls });
  return rows.length > 0;
}

export const capReachedMessage = (cap: number, resumes: string) =>
  `This month's AI limit is used up (${cap} calls). AI reasons resume on ${resumes}; the engine's own reasons still show.`;
