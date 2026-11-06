// ISO-8601 week helpers. Weeks are written as "YYYY-Www" (e.g. 2026-W42).

const DAY_MS = 86_400_000;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;

export function isValidIsoWeek(value: string): boolean {
  const m = WEEK_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const week = Number(m[2]);
  return week >= 1 && week <= weeksInIsoYear(year);
}

/** Monday (UTC) of the given ISO week. */
export function isoWeekMonday(value: string): Date {
  const m = WEEK_RE.exec(value);
  if (!m) throw new Error(`Invalid ISO week: ${value}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  // 4 January is always in week 1.
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(jan4 - jan4Dow * DAY_MS + (week - 1) * 7 * DAY_MS);
}

export function dateToIsoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Move to the Thursday of this week; its year is the ISO year.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function weeksInIsoYear(year: number): number {
  // A year has 53 ISO weeks when 28 December falls in week 53.
  return dateToIsoWeek(new Date(Date.UTC(year, 11, 28))).endsWith("53") ? 53 : 52;
}

/** The `count` ISO weeks ending at (and including) `lastWeek`, oldest first. */
export function weeksEndingAt(lastWeek: string, count: number): string[] {
  const monday = isoWeekMonday(lastWeek).getTime();
  const weeks: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    weeks.push(dateToIsoWeek(new Date(monday - i * 7 * DAY_MS)));
  }
  return weeks;
}

/** Zero-padded ISO weeks sort correctly as strings. */
export function latestWeek(weeks: Iterable<string>): string | null {
  let latest: string | null = null;
  for (const w of weeks) if (latest === null || w > latest) latest = w;
  return latest;
}

/** The `count` ISO weeks straight after `week`, oldest first. */
export function weeksAfter(week: string, count: number): string[] {
  const monday = isoWeekMonday(week).getTime();
  return Array.from({ length: count }, (_, i) => dateToIsoWeek(new Date(monday + (i + 1) * 7 * DAY_MS)));
}
