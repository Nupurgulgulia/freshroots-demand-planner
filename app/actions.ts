"use server";

import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/lib/db";
import { explainRecommendation, explainRun } from "@/lib/ai/explain";
import { geminiConfigured } from "@/lib/ai/gemini";
import { DATASET_NAMES, datasetFromFileName, type DatasetName } from "@/lib/data/csv";
import { importCsv, replaceOpenPurchaseOrders } from "@/lib/data/load";
import { capReachedMessage, getAiUsage } from "@/lib/ai/usage";
import { confirmLargeQuantity, reviewRecommendation, type Decision } from "@/lib/review";
import { getLatestRun, runEngine } from "@/lib/run-engine";
import type { Thresholds } from "@/lib/rules/engine";
import { requireAction } from "@/lib/session";
import { THRESHOLD_DEFS, fromDisplay } from "@/lib/settings";
import { setFestivalMonth, updateThresholds } from "@/lib/settings-update";
import { saveQuarterlyFigures } from "@/lib/performance-data";
import { changePassword } from "@/lib/users";
import { fetchOpenPurchaseOrders, fetchVendorsAndItems, zohoConfig, zohoOrderingEnabled } from "@/lib/zoho/inventory";
import { parseMappingCsv, saveMappings, sendDraftsToZoho, suggestMappings } from "@/lib/zoho/ordering";
import { toPurchaseOrderLines } from "@/lib/zoho/purchase-orders";

export interface ActionState {
  ok?: boolean;
  message?: string;
  errors?: string[];
}

// Every action below starts with requireAction(...): the user comes from the session (never a typed
// name), is re-checked against the database, and must have the permission for that action.

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

function revalidateAll() {
  // The whole app, including the sidebar's pending-review count.
  revalidatePath("/", "layout");
}

export async function recalculateAction(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  const { user, error } = await requireAction("recalculate");
  if (!user) return { ok: false, message: error };
  try {
    const db = await getDb();
    const run = await runEngine(db, user.username, user.id);
    revalidateAll();
    return { ok: true, message: `Run #${run.id} created for week ${run.nowWeek}.` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function generateExplanationsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, error } = await requireAction("generateAi");
  if (!user) return { ok: false, message: error };
  if (!geminiConfigured()) return { ok: false, message: "GEMINI_API_KEY is not set, so explanations are off." };
  const db = await getDb();
  const run = await getLatestRun(db);
  if (!run) return { ok: false, message: "No run yet." };
  const before = await getAiUsage(db);
  if (before.capReached) return { ok: false, message: capReachedMessage(before.cap, before.resumes) };
  const { total, failed, skippedForCap } = await explainRun(db, run.id, fd.get("force") === "1");
  revalidateAll();
  if (skippedForCap) {
    const usage = await getAiUsage(db);
    return {
      ok: false,
      message: `${total - failed - skippedForCap} of ${total} explained, then the monthly AI limit was reached. ${capReachedMessage(usage.cap, usage.resumes)}`,
    };
  }
  return failed
    ? { ok: false, message: `${total - failed} of ${total} explained; ${failed} failed (see SKU pages).` }
    : { ok: true, message: `${total} recommendations explained.` };
}

export async function regenerateAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, error } = await requireAction("generateAi");
  if (!user) return { ok: false, message: error };
  if (!geminiConfigured()) return { ok: false, message: "GEMINI_API_KEY is not set." };
  const db = await getDb();
  const result = await explainRecommendation(db, Number(fd.get("recommendationId")), true);
  revalidateAll();
  return result.error ? { ok: false, message: result.error } : { ok: true, message: "Regenerated." };
}

export async function reviewAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, error } = await requireAction("review");
  if (!user) return { ok: false, message: error };
  const qty = str(fd, "quantity");
  const db = await getDb();
  const result = await reviewRecommendation(db, {
    recommendationId: Number(fd.get("recommendationId")),
    decision: str(fd, "decision") as Decision,
    reviewer: user.username,
    userId: user.id,
    quantity: qty === "" ? null : Number(qty),
    note: str(fd, "note") || null,
  });
  if (!result.ok) return { ok: false, message: result.error };
  revalidateAll();
  return {
    ok: true,
    message: result.needsConfirmation
      ? `Saved: ${result.status.toLowerCase()}. This quantity is above the confirmation limit, so procurement must confirm it before it's sent.`
      : `Saved: ${result.status.toLowerCase()}.`,
  };
}

export async function confirmQuantityAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, error } = await requireAction("confirmLargeQty");
  if (!user) return { ok: false, message: error };
  if (fd.get("checked") !== "1") return { ok: false, message: "Tick the box to confirm you've checked this quantity." };
  const result = await confirmLargeQuantity(await getDb(), {
    recommendationId: Number(fd.get("recommendationId")),
    user: user.username,
    userId: user.id,
    note: str(fd, "note") || null,
  });
  if (!result.ok) return { ok: false, message: result.error };
  revalidateAll();
  return { ok: true, message: "Confirmed. This line is now ready to send." };
}

export async function saveThresholdsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, error } = await requireAction("editSettings");
  if (!user) return { ok: false, errors: [error] };
  const next = {} as Thresholds;
  for (const d of THRESHOLD_DEFS) {
    const raw = str(fd, d.key);
    next[d.key] = raw === "" ? NaN : fromDisplay(d, Number(raw));
  }
  const db = await getDb();
  const result = await updateThresholds(db, next, user.username, str(fd, "note") || null, user.id);
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
  const { user, error } = await requireAction("editSettings");
  if (!user) return { ok: false, message: error };
  const db = await getDb();
  const result = await setFestivalMonth(
    db,
    str(fd, "yearMonth"),
    fd.get("isFestival") === "1",
    user.username,
    user.id,
  );
  if (!result.ok) return { ok: false, message: result.error };
  revalidateAll();
  return { ok: true, message: "Calendar updated. Recalculate on the dashboard to apply it." };
}

export async function uploadAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, error } = await requireAction("upload");
  if (!user) return { ok: false, errors: [error] };
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
    const result = await importCsv(db, dataset, await file.text(), file.name, user.username, user.id);
    if (result.ok) messages.push(`${file.name} → ${dataset}: ${result.rowCount} rows loaded.`);
    else errors.push(`${file.name} → ${dataset}: rejected, nothing saved.`, ...result.errors.slice(0, 20));
  }

  if (fd.get("rerun") === "1" && messages.length > 0 && errors.length === 0) {
    try {
      const run = await runEngine(db, user.username, user.id);
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
  const { user, error } = await requireAction("upload");
  if (!user) return { ok: false, errors: [error] };
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
      uploadedBy: user.username,
      userId: user.id,
    });

    const known = new Set((await db.select({ id: schema.skus.skuId }).from(schema.skus)).map((r) => r.id));
    const unknown = [...new Set(lines.map((l) => l.skuId).filter((id) => !known.has(id)))];
    const messages = [`Synced ${pos.length} open purchase orders (${lines.length} lines) from Zoho Inventory.`];
    if (unknown.length) messages.push(`Not in the SKU master, so ignored: ${unknown.join(", ")}.`);
    if (skippedNoSku) messages.push(`${skippedNoSku} line(s) had no SKU code in Zoho and were skipped.`);

    if (fd.get("rerun") === "1") {
      const run = await runEngine(db, user.username, user.id);
      messages.push(`Engine run #${run.id} created for week ${run.nowWeek}.`);
    }
    revalidateAll();
    return { ok: true, message: messages.join("\n") };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

const rupees = (fd: FormData, key: string) => {
  const raw = str(fd, key).replace(/[₹,\s]/g, "");
  return raw === "" ? null : Number(raw);
};

export async function saveFiguresAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, error } = await requireAction("enterFigures");
  if (!user) return { ok: false, message: error };
  const result = await saveQuarterlyFigures(
    await getDb(),
    {
      quarter: str(fd, "quarter").toUpperCase(),
      baselineLoss: rupees(fd, "baseline"),
      targetLoss: rupees(fd, "target"),
      actualLoss: rupees(fd, "actual"),
      note: str(fd, "note") || null,
    },
    user,
  );
  if (!result.ok) return { ok: false, message: result.error };
  revalidateAll();
  return { ok: true, message: "Saved. Shown as entered figures." };
}

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, error } = await requireAction("viewDashboard");
  if (!user) return { ok: false, message: error };
  const next = String(fd.get("next") ?? "");
  if (next !== String(fd.get("confirm") ?? "")) return { ok: false, message: "The two new passwords don't match." };
  const result = await changePassword(await getDb(), user.id, String(fd.get("current") ?? ""), next);
  return result.ok ? { ok: true, message: "Password changed." } : { ok: false, message: result.error };
}

// ---------- Zoho ordering (drafts only) ----------

export async function sendToZohoAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, error } = await requireAction("sendToZoho");
  if (!user) return { ok: false, message: error };
  if (!zohoOrderingEnabled()) return { ok: false, message: "Sending to Zoho is switched off (ZOHO_ORDERING_ENABLED)." };
  const db = await getDb();
  const runId = Number(fd.get("runId"));
  const latest = await getLatestRun(db);
  if (!latest || latest.id !== runId) return { ok: false, message: "A newer run exists. Reload the page and check the orders again." };
  const distributorId = str(fd, "distributorId");
  const results = await sendDraftsToZoho(db, runId, user, {
    distributorIds: distributorId ? [distributorId] : undefined,
    confirmUnknown: fd.get("checkedZoho") === "1",
  });
  revalidateAll();
  if (results.length === 0) return { ok: false, message: "Nothing to send: no ready lines." };
  const failed = results.filter((r) => r.outcome === "failed" || r.outcome === "unknown");
  return {
    ok: failed.length === 0,
    message: results.map((r) => `${r.distributorId}: ${r.message}`).join("\n"),
  };
}

export async function saveZohoMappingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, error } = await requireAction("manageZohoMapping");
  if (!user) return { ok: false, message: error };
  const rows: { type: "vendor" | "item"; ourId: string; zohoId: string }[] = [];
  for (const [key, value] of fd.entries()) {
    const m = /^(vendor|item):(.+)$/.exec(key);
    if (m && typeof value === "string") rows.push({ type: m[1] as "vendor" | "item", ourId: m[2], zohoId: value.trim() });
  }
  await saveMappings(await getDb(), rows, user);
  revalidateAll();
  return { ok: true, message: "Mapping saved." };
}

export async function importZohoMappingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, error } = await requireAction("manageZohoMapping");
  if (!user) return { ok: false, message: error };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose zoho_mapping.csv first." };
  const db = await getDb();
  const [distributors, skus] = await Promise.all([
    db.select({ id: schema.distributors.distributorId }).from(schema.distributors),
    db.select({ id: schema.skus.skuId }).from(schema.skus),
  ]);
  const { rows, errors } = parseMappingCsv(await file.text(), {
    distributors: new Set(distributors.map((d) => d.id)),
    skus: new Set(skus.map((s) => s.id)),
  });
  if (errors.length) return { ok: false, message: "Nothing saved.", errors: errors.slice(0, 20) };
  await saveMappings(db, rows, user);
  revalidateAll();
  return { ok: true, message: `${rows.length} mapping rows saved.` };
}

export async function suggestZohoMappingAction(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  const { user, error } = await requireAction("manageZohoMapping");
  if (!user) return { ok: false, message: error };
  const config = zohoConfig();
  if (!config) return { ok: false, message: "Zoho isn't connected yet (ZOHO_* settings)." };
  const db = await getDb();
  try {
    const [zoho, distributors, skus, vendorMap, itemMap] = await Promise.all([
      fetchVendorsAndItems(config),
      db.select({ distributorId: schema.distributors.distributorId, name: schema.distributors.name }).from(schema.distributors),
      db.select({ skuId: schema.skus.skuId }).from(schema.skus),
      db.select().from(schema.zohoVendorMap),
      db.select().from(schema.zohoItemMap),
    ]);
    const s = suggestMappings(zoho, { distributors, skus });
    // Only fill gaps; never overwrite a mapping someone set by hand.
    const mappedVendors = new Set(vendorMap.map((v) => v.distributorId));
    const mappedItems = new Set(itemMap.map((i) => i.skuId));
    const fresh = [...s.vendors.filter((v) => !mappedVendors.has(v.ourId)), ...s.items.filter((i) => !mappedItems.has(i.ourId))];
    await saveMappings(db, fresh, user);
    revalidateAll();
    return {
      ok: true,
      message: `Filled ${fresh.length} empty mappings from Zoho (${s.vendors.length} vendor and ${s.items.length} item matches found). Check them before sending.`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
