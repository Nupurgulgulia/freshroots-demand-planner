export const fmt1 = (x: number | null | undefined) =>
  x == null ? "—" : x.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmtInt = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("en-IN"));

export const fmtPct = (x: number | null | undefined) =>
  x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

export const fmtDateTime = (d: Date | string | null | undefined) =>
  d == null
    ? "—"
    : new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
