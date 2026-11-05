export const fmt1 = (x: number | null | undefined) =>
  x == null ? "—" : x.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmtInt = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("en-IN"));

export const fmtPct = (x: number | null | undefined) =>
  x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

export const fmtDateTime = (d: Date | string | null | undefined) =>
  d == null
    ? "—"
    : new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

/** Weeks of cover to 1 decimal, or 2 when 1 decimal would land exactly on a limit (2.98 shown as "3.0" looks safe). */
export const fmtCover = (weeks: number | null | undefined, limits: (number | null | undefined)[]) => {
  if (weeks == null) return "—";
  const onLimit = limits.some((l) => l != null && Math.round(weeks * 10) / 10 === l && weeks !== l);
  return weeks.toLocaleString("en-IN", {
    minimumFractionDigits: onLimit ? 2 : 1,
    maximumFractionDigits: onLimit ? 2 : 1,
  });
};
