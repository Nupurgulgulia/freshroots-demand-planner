// Run history: a summary of each past run, and what changed between two runs.
// summarise() and compareRuns() are pure so they are unit-tested; the loaders below only fetch rows.

import { desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import type { Evaluation, Flag, Thresholds } from "@/lib/rules/engine";
import { THRESHOLD_DEFS, toDisplay } from "@/lib/settings";

export interface RunLine {
  skuId: string;
  name: string | null;
  flag: string;
  action: string;
  quantity: number | null;
  isException: boolean;
  status: string;
  finalQuantity: number | null;
  weeksOfCover: number | null;
  demandBaseline: number | null;
}

export interface RunSummary {
  skus: number;
  flags: Record<Flag, number>;
  exceptions: number;
  actionable: number;
  pending: number;
  decided: number;
  /** Units the engine recommended ordering (REORDER lines). */
  recommendedUnits: number;
  /** Units approved by planners (approved or edited lines). */
  approvedUnits: number;
}

const DECIDED = ["APPROVED", "EDITED", "REJECTED"];

export function summarise(lines: RunLine[]): RunSummary {
  const flags: Record<Flag, number> = { EXCEPTION: 0, STOCKOUT: 0, OVERSTOCK: 0, HIGH_DEMAND: 0, NO_ACTION: 0 };
  let recommendedUnits = 0;
  let approvedUnits = 0;
  for (const l of lines) {
    if (l.flag in flags) flags[l.flag as Flag]++;
    if (l.action === "REORDER") recommendedUnits += l.quantity ?? 0;
    if (l.status === "APPROVED" || l.status === "EDITED") approvedUnits += l.finalQuantity ?? l.quantity ?? 0;
  }
  return {
    skus: lines.length,
    flags,
    exceptions: lines.filter((l) => l.isException).length,
    actionable: lines.filter((l) => l.action !== "NONE").length,
    pending: lines.filter((l) => l.status === "PENDING").length,
    decided: lines.filter((l) => DECIDED.includes(l.status)).length,
    recommendedUnits,
    approvedUnits,
  };
}

export type ChangeKind = "new" | "dropped" | "flag" | "quantity" | "exception";

export interface SkuChange {
  skuId: string;
  name: string | null;
  kinds: ChangeKind[];
  a: RunLine | null;
  b: RunLine | null;
}

export interface ThresholdChange {
  label: string;
  a: number;
  b: number;
  unit: string;
}

export interface RunComparison {
  changes: SkuChange[];
  unchanged: number;
  thresholdChanges: ThresholdChange[];
}

/** What differs from run A (older) to run B (newer): per-SKU recommendation changes and threshold edits. */
export function compareRuns(
  a: { lines: RunLine[]; thresholds: Partial<Thresholds> },
  b: { lines: RunLine[]; thresholds: Partial<Thresholds> },
): RunComparison {
  const byA = new Map(a.lines.map((l) => [l.skuId, l]));
  const byB = new Map(b.lines.map((l) => [l.skuId, l]));
  const ids = [...new Set([...byA.keys(), ...byB.keys()])].sort();
  const changes: SkuChange[] = [];
  let unchanged = 0;
  for (const id of ids) {
    const la = byA.get(id) ?? null;
    const lb = byB.get(id) ?? null;
    const kinds: ChangeKind[] = [];
    if (!la) kinds.push("new");
    else if (!lb) kinds.push("dropped");
    else {
      if (la.flag !== lb.flag || la.action !== lb.action) kinds.push("flag");
      else if ((la.quantity ?? null) !== (lb.quantity ?? null)) kinds.push("quantity");
      if (la.isException !== lb.isException) kinds.push("exception");
    }
    if (kinds.length) changes.push({ skuId: id, name: lb?.name ?? la?.name ?? null, kinds, a: la, b: lb });
    else unchanged++;
  }

  const thresholdChanges: ThresholdChange[] = [];
  for (const def of THRESHOLD_DEFS) {
    const va = a.thresholds[def.key];
    const vb = b.thresholds[def.key];
    // Runs saved before a threshold existed have no value for it; that's not a change.
    if (va == null || vb == null || va === vb) continue;
    const unit = def.unit === "percent" ? "%" : def.unit === "weeks" ? " wks" : "×";
    thresholdChanges.push({ label: def.label, a: toDisplay(def, va), b: toDisplay(def, vb), unit });
  }
  return { changes, unchanged, thresholdChanges };
}

async function loadLines(db: Db, runIds: number[]) {
  if (runIds.length === 0) return new Map<number, RunLine[]>();
  const rows = await db
    .select({ rec: schema.recommendations, name: schema.skus.name })
    .from(schema.recommendations)
    .leftJoin(schema.skus, eq(schema.skus.skuId, schema.recommendations.skuId))
    .where(inArray(schema.recommendations.runId, runIds))
    .orderBy(schema.recommendations.skuId);
  const out = new Map<number, RunLine[]>();
  for (const { rec, name } of rows) {
    const e = rec.evaluation as Evaluation;
    const line: RunLine = {
      skuId: rec.skuId,
      name,
      flag: rec.flag,
      action: rec.action,
      quantity: rec.quantity,
      isException: rec.isException,
      status: rec.status,
      finalQuantity: rec.finalQuantity,
      weeksOfCover: e.weeksOfCover ?? null,
      demandBaseline: e.demandBaseline ?? null,
    };
    out.set(rec.runId, [...(out.get(rec.runId) ?? []), line]);
  }
  return out;
}

/** The most recent runs with a summary each, newest first. */
export async function getRunHistory(db: Db, limit = 30) {
  const runs = await db.select().from(schema.runs).orderBy(desc(schema.runs.id)).limit(limit);
  const lines = await loadLines(
    db,
    runs.map((r) => r.id),
  );
  return runs.map((run) => ({ run, summary: summarise(lines.get(run.id) ?? []) }));
}

/** Compares two runs by id; the older one is always A. Null if either run doesn't exist. */
export async function getRunComparison(db: Db, idA: number, idB: number) {
  const [older, newer] = idA <= idB ? [idA, idB] : [idB, idA];
  const runs = await db.select().from(schema.runs).where(inArray(schema.runs.id, [older, newer]));
  const runA = runs.find((r) => r.id === older);
  const runB = runs.find((r) => r.id === newer);
  if (!runA || !runB || older === newer) return null;
  const lines = await loadLines(db, [older, newer]);
  const la = lines.get(older) ?? [];
  const lb = lines.get(newer) ?? [];
  return {
    runA,
    runB,
    summaryA: summarise(la),
    summaryB: summarise(lb),
    ...compareRuns(
      { lines: la, thresholds: runA.thresholds as Partial<Thresholds> },
      { lines: lb, thresholds: runB.thresholds as Partial<Thresholds> },
    ),
  };
}
