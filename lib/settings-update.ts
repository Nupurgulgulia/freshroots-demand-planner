// Edits to thresholds and the festival calendar. Every change is logged.

import { desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import type { Thresholds } from "@/lib/rules/engine";
import { THRESHOLD_DEFS, getThresholds, validateThresholds } from "@/lib/settings";

export async function updateThresholds(db: Db, next: Thresholds, changedBy: string, note: string | null) {
  if (!changedBy.trim()) return { ok: false as const, errors: ["Enter your name."] };
  const errors = validateThresholds(next);
  if (errors.length) return { ok: false as const, errors };

  const current = await getThresholds(db);
  const changed = THRESHOLD_DEFS.filter((d) => current[d.key] !== next[d.key]);
  if (changed.length === 0) return { ok: true as const, changed: 0 };

  await db.transaction(async (tx) => {
    for (const d of changed) {
      await tx
        .update(schema.settings)
        .set({ value: next[d.key], updatedAt: new Date(), updatedBy: changedBy.trim() })
        .where(eq(schema.settings.key, d.key));
      await tx.insert(schema.settingsLog).values({
        area: "threshold",
        key: d.key,
        oldValue: String(current[d.key]),
        newValue: String(next[d.key]),
        changedBy: changedBy.trim(),
        note,
      });
    }
  });
  return { ok: true as const, changed: changed.length };
}

export async function setFestivalMonth(db: Db, yearMonth: string, isFestival: boolean, changedBy: string) {
  if (!changedBy.trim()) return { ok: false as const, error: "Enter your name." };
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return { ok: false as const, error: "Month must be YYYY-MM." };

  const [existing] = await db
    .select()
    .from(schema.festivalCalendar)
    .where(eq(schema.festivalCalendar.yearMonth, yearMonth));
  if (existing && existing.isFestivalMonth === isFestival) return { ok: true as const };

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.festivalCalendar)
      .values({ yearMonth, year: Number(m[1]), month: Number(m[2]), isFestivalMonth: isFestival })
      .onConflictDoUpdate({ target: schema.festivalCalendar.yearMonth, set: { isFestivalMonth: isFestival } });
    await tx.insert(schema.settingsLog).values({
      area: "calendar",
      key: yearMonth,
      oldValue: existing ? String(existing.isFestivalMonth) : null,
      newValue: String(isFestival),
      changedBy: changedBy.trim(),
    });
  });
  return { ok: true as const };
}

export async function getSettingsLog(db: Db, limit = 50) {
  return db.select().from(schema.settingsLog).orderBy(desc(schema.settingsLog.id)).limit(limit);
}
