// Thresholds live in the `settings` table so the planner can edit them.

import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { DEFAULT_THRESHOLDS, type Thresholds } from "@/lib/rules/engine";

export type ThresholdKey = keyof Thresholds;

export interface ThresholdDef {
  key: ThresholdKey;
  label: string;
  /** How the value is shown and edited; stored values are always engine units. */
  unit: "weeks" | "percent" | "multiplier";
}

export const THRESHOLD_DEFS: ThresholdDef[] = [
  { key: "stockoutWeeks", label: "Stockout risk below (Low perishability)", unit: "weeks" },
  { key: "overstockWeeks", label: "Overstock risk above (Low perishability)", unit: "weeks" },
  { key: "stockoutWeeksPerishable", label: "Stockout risk below (High perishability)", unit: "weeks" },
  { key: "overstockWeeksPerishable", label: "Overstock risk above (High perishability)", unit: "weeks" },
  { key: "highDemandPct", label: "High demand when 4-week avg exceeds 12-week avg by", unit: "percent" },
  { key: "highDemandMultiplier", label: "High-demand reorder (× standard quantity)", unit: "multiplier" },
  { key: "festivalUpliftPct", label: "Festival-month demand uplift", unit: "percent" },
];

/** Engine value -> value shown in the UI (0.2 -> 20). */
export function toDisplay(def: ThresholdDef, value: number): number {
  return def.unit === "percent" ? Math.round(value * 100 * 1e6) / 1e6 : value;
}

/** UI value -> engine value (20 -> 0.2). */
export function fromDisplay(def: ThresholdDef, value: number): number {
  return def.unit === "percent" ? value / 100 : value;
}

export function formatThreshold(def: ThresholdDef, value: number): string {
  const v = toDisplay(def, value);
  return def.unit === "percent" ? `${v}%` : def.unit === "multiplier" ? `${v}×` : `${v} weeks`;
}

/** Ensures every threshold has a row (inserting defaults) and returns them. */
export async function getThresholds(db: Db): Promise<Thresholds> {
  const rows = await db.select().from(schema.settings);
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const missing = THRESHOLD_DEFS.filter((d) => !stored.has(d.key));
  if (missing.length) {
    await db
      .insert(schema.settings)
      .values(missing.map((d) => ({ key: d.key, value: DEFAULT_THRESHOLDS[d.key], updatedBy: "system" })))
      .onConflictDoNothing();
  }
  const result = { ...DEFAULT_THRESHOLDS };
  for (const d of THRESHOLD_DEFS) if (stored.has(d.key)) result[d.key] = stored.get(d.key)!;
  return result;
}

/** Checks a full set of thresholds for values the engine cannot use sensibly. */
export function validateThresholds(t: Thresholds): string[] {
  const errors: string[] = [];
  for (const d of THRESHOLD_DEFS) {
    const v = t[d.key];
    if (!Number.isFinite(v) || v < 0) errors.push(`${d.label}: must be a number ≥ 0.`);
  }
  if (t.stockoutWeeks >= t.overstockWeeks) errors.push("Low perishability: stockout weeks must be below overstock weeks.");
  if (t.stockoutWeeksPerishable >= t.overstockWeeksPerishable) {
    errors.push("High perishability: stockout weeks must be below overstock weeks.");
  }
  if (t.highDemandMultiplier <= 0) errors.push("High-demand reorder multiple must be above 0.");
  return errors;
}
