"use server";

import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/lib/db";
import { explainRecommendation, explainRun } from "@/lib/ai/explain";
import { geminiConfigured } from "@/lib/ai/gemini";
import { DATASET_NAMES, datasetFromFileName, type DatasetName } from "@/lib/data/csv";
import { importCsv, replaceOpenPurchaseOrders } from "@/lib/data/load";
import { reviewRecommendation, type Decision } from "@/lib/review";
import { getLatestRun, runEngine } from "@/lib/run-engine";
import type { Thresholds } from "@/lib/rules/engine";
import { THRESHOLD_DEFS, fromDisplay } from "@/lib/settings";
import { setFestivalMonth, updateThresholds } from "@/lib/settings-update";
import { fetchOpenPurchaseOrders, zohoConfig } from "@/lib/zoho/inventory";
import { toPurchaseOrderLines } from "@/lib/zoho/purchase-orders";

export interface ActionState {
  ok?: boolean;
  message?: string;
  errors?: string[];
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

function revalidateAll() {
  // The whole app, including the sidebar's pending-review count.
  revalidatePath("/", "layout");
}

export async function recalculateAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const db = await getDb();
    const run = await runEngine(db, str(fd, "name") || "planner");
    revalidateAll();
    return { ok: true, message: `Run #${run.id} created for week ${run.nowWeek}.` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function generateExplanationsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!geminiConfigured()) return { ok: false, message: "GEMINI_API_KEY is not set, so explanations are off." };
  const db = await getDb();
  const run = await getLatestRun(db);
  if (!run) return { ok: false, message: "No run yet." };
  const { total, failed } = await explainRun(db, run.id, fd.get("force") === "1");
  revalidateAll();
  return failed
    ? { ok: false, message: `${total - failed} of ${total} explained; ${failed} failed (see SKU pages).` }
    : { ok: true, message: `${total} recommendations explained.` };
}

export async function regenerateAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!geminiConfigured()) return { ok: false, message: "GEMINI_API_KEY is not set." };
  const db = await getDb();
  const result = await explainRecommendation(db, Number(fd.get("recommendationId")), true);
  revalidateAll();
  return result.error ? { ok: false, message: result.error } : { ok: true, message: "Regenerated." };
}

export async function reviewAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const qty = str(fd, "quantity");
  const db = await getDb();
  const result = await reviewRecommendation(db, {
    recommendationId: Number(fd.get("recommendationId")),
    decision: str(fd, "decision") as Decision,
    reviewer: str(fd, "reviewer"),
    quantity: qty === "" ? null : Number(qty),
    note: str(fd, "note") || null,
  });
  if (!result.ok) return { ok: false, message: result.error };
  revalidateAll();
  return { ok: true, message: `Saved: ${result.status.toLowerCase()}.` };
}

export async function saveThresholdsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const next = {} as Thresholds;
  for (const d of THRESHOLD_DEFS) {
    const raw = str(fd, d.key);
    next[d.key] = raw === "" ? NaN : fromDisplay(d, Number(raw));
  }
  const db = await getDb();
  const result = await updateThresholds(db, next, str(fd, "name"), str(fd, "note") || null);
  if (!result.ok) return { ok: false, errors: result.errors };
  revalidateAll();
  return {
    ok: true,
    message: result.changed
      ? `${result.changed} threshold(s) saved. Recalculate on the dashboard to apply them.`
      : "No changes.",
  };
}

export async function festivalMonthAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const db = await getDb();
  const result = await setFestivalMonth(db, str(fd, "yearMonth"), fd.get("isFestival") === "1", str(fd, "name"));
  if (!result.ok) return { ok: false, message: result.error };
  revalidateAll();
  return { ok: true, message: "Calendar updated. Recalculate on the dashboard to apply it." };
}

export async function uploadAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const name = str(fd, "name");
  if (!name) return { ok: false, errors: ["Enter your name."] };
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, errors: ["Choose at least one CSV file."] };
  const chosen = str(fd, "dataset");

  const db = await getDb();
  const messages: string[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const dataset: DatasetName | null =
      files.length === 1 && DATASET_NAMES.includes(chosen as DatasetName)
        ? (chosen as DatasetName)
        : datasetFromFileName(file.name);
    if (!dataset) {
      errors.push(`${file.name}: cannot tell which dataset this is. Name it like weekly_sales.csv or pick the type.`);
      continue;
    }
    const result = await importCsv(db, dataset, await file.text(), file.name, name);
    if (result.ok) messages.push(`${file.name} → ${dataset}: ${result.rowCount} rows loaded.`);
    else errors.push(`${file.name} → ${dataset}: rejected, nothing saved.`, ...result.errors.slice(0, 20));
  }

  if (fd.get("rerun") === "1" && messages.length > 0 && errors.length === 0) {
    try {
      const run = await runEngine(db, name);
      messages.push(`Engine run #${run.id} created for week ${run.nowWeek}.`);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  revalidateAll();
  return { ok: errors.length === 0, message: messages.join("\n"), errors };
}

/** Replaces the open-PO snapshot with Zoho Inventory's open purchase orders, then optionally recalculates. */
export async function syncZohoAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const name = str(fd, "name");
  if (!name) return { ok: false, errors: ["Enter your name."] };
  const config = zohoConfig();
  if (!config) return { ok: false, errors: ["Zoho isn't connected yet. Set the ZOHO_* settings first (see the README)."] };

  const db = await getDb();
  try {
    const pos = await fetchOpenPurchaseOrders(config);
    const { lines, skippedNoSku } = toPurchaseOrderLines(pos);
    await db.transaction((tx) => replaceOpenPurchaseOrders(tx as unknown as typeof db, lines, "zoho"));
    await db.insert(schema.uploads).values({
      dataset: "open_purchase_orders",
      fileName: "Zoho Inventory sync",
      rowCount: lines.length,
      uploadedBy: name,
    });

    const known = new Set((await db.select({ id: schema.skus.skuId }).from(schema.skus)).map((r) => r.id));
    const unknown = [...new Set(lines.map((l) => l.skuId).filter((id) => !known.has(id)))];
    const messages = [`Synced ${pos.length} open purchase orders (${lines.length} lines) from Zoho Inventory.`];
    if (unknown.length) messages.push(`Not in the SKU master, so ignored: ${unknown.join(", ")}.`);
    if (skippedNoSku) messages.push(`${skippedNoSku} line(s) had no SKU code in Zoho and were skipped.`);

    if (fd.get("rerun") === "1") {
      const run = await runEngine(db, name);
      messages.push(`Engine run #${run.id} created for week ${run.nowWeek}.`);
    }
    revalidateAll();
    return { ok: true, message: messages.join("\n") };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
