// Sending approved orders to Zoho Inventory as DRAFT purchase orders: one per distributor (the vendor)
// per run. Nothing is ever issued. A stable reference per run + distributor, stored with a unique key,
// stops duplicates; failures are recorded per distributor and can be retried.

import { and, eq, inArray, lt } from "drizzle-orm";
import Papa from "papaparse";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { getApprovedOrders, isReadyToSend } from "@/lib/review";
import {
  createDraftPurchaseOrder,
  ZohoApiError,
  zohoConfig,
  type DraftPurchaseOrderInput,
  type ZohoItem,
  type ZohoVendor,
} from "./inventory";

export const zohoReference = (runId: number, distributorId: string) => `FR-R${runId}-${distributorId}`;

export type SendStatus = "sending" | "sent" | "failed" | "unknown";

export interface DraftLine {
  recommendationId: number;
  skuId: string;
  skuName: string | null;
  distributorId: string | null;
  quantity: number;
  alreadyOnPo: string | null; // Zoho PO number, if this line already went to Zoho
}

export interface DraftGroup {
  distributorId: string;
  reference: string;
  vendorId: string | null;
  lines: (DraftLine & { itemId: string | null })[];
  /** Lines approved after this distributor's draft was sent: add them in Zoho by hand. */
  lateLines: DraftLine[];
  missingItems: string[];
  send: { status: SendStatus; poNumber: string | null; error: string | null; attempts: number } | null;
  /** What the button can do now. */
  state: "ready" | "unmapped" | "sent" | "failed" | "unknown" | "sending" | "empty";
}

/** Groups the ready-to-send lines by distributor and works out what can be sent. Pure. */
export function planDrafts(
  runId: number,
  lines: DraftLine[],
  vendorMap: Map<string, string>,
  itemMap: Map<string, string>,
  sends: Map<string, { status: string; zohoPurchaseorderNumber: string | null; error: string | null; attempts: number }>,
): DraftGroup[] {
  const byDistributor = new Map<string, DraftLine[]>();
  for (const l of lines) {
    const d = l.distributorId ?? "UNKNOWN";
    byDistributor.set(d, [...(byDistributor.get(d) ?? []), l]);
  }
  return [...byDistributor.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([distributorId, list]) => {
      const sendRow = sends.get(distributorId);
      const send = sendRow
        ? {
            status: sendRow.status as SendStatus,
            poNumber: sendRow.zohoPurchaseorderNumber,
            error: sendRow.error,
            attempts: sendRow.attempts,
          }
        : null;
      const sentAlready = send?.status === "sent";
      const toSend = sentAlready ? list.filter((l) => l.alreadyOnPo) : list;
      const lateLines = sentAlready ? list.filter((l) => !l.alreadyOnPo) : [];
      const withItems = toSend.map((l) => ({ ...l, itemId: itemMap.get(l.skuId) ?? null }));
      const vendorId = vendorMap.get(distributorId) ?? null;
      const missingItems = withItems.filter((l) => !l.itemId).map((l) => l.skuId);
      const state: DraftGroup["state"] = sentAlready
        ? "sent"
        : send?.status === "sending"
          ? "sending"
          : !vendorId || missingItems.length || distributorId === "UNKNOWN"
            ? "unmapped"
            : send?.status === "failed"
              ? "failed"
              : send?.status === "unknown"
                ? "unknown"
                : withItems.length === 0
                  ? "empty"
                  : "ready";
      return {
        distributorId,
        reference: zohoReference(runId, distributorId),
        vendorId,
        lines: withItems,
        lateLines,
        missingItems,
        send,
        state,
      };
    });
}

/** A send still "sending" after this long crashed mid-way; treat it as "unknown" (check Zoho, then retry). */
const STALE_SENDING_MS = 10 * 60_000;

export async function getDraftPlan(db: Db, runId: number) {
  await db
    .update(schema.zohoPoSends)
    .set({ status: "unknown", error: "The send stopped before Zoho's answer was recorded." })
    .where(
      and(
        eq(schema.zohoPoSends.runId, runId),
        eq(schema.zohoPoSends.status, "sending"),
        lt(schema.zohoPoSends.lastAttemptAt, new Date(Date.now() - STALE_SENDING_MS)),
      ),
    );
  const [orders, vendors, items, sends] = await Promise.all([
    getApprovedOrders(db, runId),
    db.select().from(schema.zohoVendorMap),
    db.select().from(schema.zohoItemMap),
    db.select().from(schema.zohoPoSends).where(eq(schema.zohoPoSends.runId, runId)),
  ]);
  const recIds = orders.map((o) => o.recommendationId);
  const onPo = recIds.length
    ? await db
        .select({ id: schema.recommendations.id, po: schema.recommendations.zohoPurchaseorderNumber })
        .from(schema.recommendations)
        .where(inArray(schema.recommendations.id, recIds))
    : [];
  const poByRec = new Map(onPo.map((r) => [r.id, r.po]));
  const lines: DraftLine[] = orders.filter(isReadyToSend).map((o) => ({
    recommendationId: o.recommendationId,
    skuId: o.skuId,
    skuName: o.skuName,
    distributorId: o.distributorId,
    quantity: o.finalQuantity ?? 0,
    alreadyOnPo: poByRec.get(o.recommendationId) ?? null,
  }));
  return planDrafts(
    runId,
    lines,
    new Map(vendors.map((v) => [v.distributorId, v.zohoVendorId])),
    new Map(items.map((i) => [i.skuId, i.zohoItemId])),
    new Map(sends.map((s) => [s.distributorId, s])),
  );
}

export type CreateDraft = (input: DraftPurchaseOrderInput) => Promise<{ purchaseorderId: string; purchaseorderNumber: string }>;

/** The real Zoho call, or an error if Zoho isn't configured. */
export function defaultCreateDraft(): CreateDraft {
  return async (input) => {
    const config = zohoConfig();
    if (!config) throw new ZohoApiError("Zoho isn't connected (ZOHO_* settings missing).", true);
    return createDraftPurchaseOrder(config, input);
  };
}

export interface SendResult {
  distributorId: string;
  reference: string;
  outcome: "created" | "skipped" | "failed" | "unknown";
  message: string;
}

/**
 * Sends a draft PO for each distributor that is ready (or the ones listed). Each distributor is
 * claimed in the database first, so two people pressing the button at once can't both create one.
 * A distributor whose last attempt got no answer ("unknown") is only retried with confirmUnknown,
 * after someone has checked in Zoho that the PO wasn't created.
 */
export async function sendDraftsToZoho(
  db: Db,
  runId: number,
  user: { username: string; id: number | null },
  options: { distributorIds?: string[]; confirmUnknown?: boolean; today?: string; createDraft?: CreateDraft } = {},
): Promise<SendResult[]> {
  const plan = await getDraftPlan(db, runId);
  const createDraft = options.createDraft ?? defaultCreateDraft();
  // The PO date is today in India, not UTC (just after midnight IST is still "yesterday" in UTC).
  const today = options.today ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const results: SendResult[] = [];

  for (const g of plan) {
    if (options.distributorIds && !options.distributorIds.includes(g.distributorId)) continue;
    const skip = (message: string) =>
      results.push({ distributorId: g.distributorId, reference: g.reference, outcome: "skipped", message });

    if (g.state === "sent") {
      skip(`Already sent as draft ${g.send?.poNumber ?? ""} (${g.reference}); not sent again.`);
      continue;
    }
    if (g.state === "sending") {
      skip("Another send for this distributor is in progress.");
      continue;
    }
    if (g.state === "unmapped") {
      const parts = [
        !g.vendorId ? "no Zoho vendor mapped" : null,
        g.missingItems.length ? `no Zoho item for ${g.missingItems.join(", ")}` : null,
      ].filter(Boolean);
      skip(`Not sent: ${parts.join("; ")}. Fix it on the Zoho mapping page.`);
      continue;
    }
    if (g.state === "empty") continue;
    if (g.state === "unknown" && !options.confirmUnknown) {
      skip(`The last attempt got no answer from Zoho. Check Zoho for reference ${g.reference} before retrying.`);
      continue;
    }

    // Claim this run + distributor. Insert a new row, or move a failed/unknown one back to "sending".
    const units = g.lines.reduce((a, l) => a + l.quantity, 0);
    const claimed = g.send
      ? await db
          .update(schema.zohoPoSends)
          .set({ status: "sending", error: null, lastAttemptAt: new Date(), sentBy: user.username, userId: user.id, lineCount: g.lines.length, units })
          .where(
            and(
              eq(schema.zohoPoSends.reference, g.reference),
              inArray(schema.zohoPoSends.status, options.confirmUnknown ? ["failed", "unknown"] : ["failed"]),
            ),
          )
          .returning({ id: schema.zohoPoSends.id })
      : await db
          .insert(schema.zohoPoSends)
          .values({
            runId,
            distributorId: g.distributorId,
            reference: g.reference,
            status: "sending",
            lineCount: g.lines.length,
            units,
            sentBy: user.username,
            userId: user.id,
          })
          .onConflictDoNothing()
          .returning({ id: schema.zohoPoSends.id });
    if (claimed.length === 0) {
      skip("Someone else is sending or has sent this distributor's draft.");
      continue;
    }

    try {
      const po = await createDraft({
        vendorId: g.vendorId!,
        referenceNumber: g.reference,
        date: today,
        lineItems: g.lines.map((l) => ({ itemId: l.itemId!, quantity: l.quantity })),
        notes: `Draft created by the Freshroots demand planner (run #${runId}). Review in Zoho before issuing.`,
      });
      await db.transaction(async (tx) => {
        await tx
          .update(schema.zohoPoSends)
          .set({
            status: "sent",
            zohoPurchaseorderId: po.purchaseorderId,
            zohoPurchaseorderNumber: po.purchaseorderNumber,
            sentAt: new Date(),
            attempts: (g.send?.attempts ?? 0) + 1,
          })
          .where(eq(schema.zohoPoSends.reference, g.reference));
        await tx
          .update(schema.recommendations)
          .set({ zohoPurchaseorderId: po.purchaseorderId, zohoPurchaseorderNumber: po.purchaseorderNumber })
          .where(inArray(schema.recommendations.id, g.lines.map((l) => l.recommendationId)));
      });
      results.push({
        distributorId: g.distributorId,
        reference: g.reference,
        outcome: "created",
        message: `Draft ${po.purchaseorderNumber} created in Zoho (${g.lines.length} line${g.lines.length === 1 ? "" : "s"}, ${units} units). Review and issue it in Zoho.`,
      });
    } catch (err) {
      const definite = err instanceof ZohoApiError ? err.definite : false;
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(schema.zohoPoSends)
        .set({ status: definite ? "failed" : "unknown", error: message, attempts: (g.send?.attempts ?? 0) + 1 })
        .where(eq(schema.zohoPoSends.reference, g.reference));
      results.push({
        distributorId: g.distributorId,
        reference: g.reference,
        outcome: definite ? "failed" : "unknown",
        message: definite
          ? `Failed: ${message} Nothing was created; you can retry.`
          : `No answer from Zoho: ${message} Check Zoho for reference ${g.reference} before retrying.`,
      });
    }
  }
  return results;
}

// ---------- Mapping ----------

export async function saveMappings(
  db: Db,
  rows: { type: "vendor" | "item"; ourId: string; zohoId: string; zohoName?: string | null }[],
  user: { username: string; id: number | null },
) {
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const r of rows) {
      if (r.type === "vendor") {
        if (!r.zohoId) {
          await tx.delete(schema.zohoVendorMap).where(eq(schema.zohoVendorMap.distributorId, r.ourId));
          continue;
        }
        const v = { zohoVendorId: r.zohoId, zohoVendorName: r.zohoName ?? null, updatedBy: user.username, userId: user.id, updatedAt: now };
        await tx.insert(schema.zohoVendorMap).values({ distributorId: r.ourId, ...v }).onConflictDoUpdate({ target: schema.zohoVendorMap.distributorId, set: v });
      } else {
        if (!r.zohoId) {
          await tx.delete(schema.zohoItemMap).where(eq(schema.zohoItemMap.skuId, r.ourId));
          continue;
        }
        const v = { zohoItemId: r.zohoId, zohoItemName: r.zohoName ?? null, updatedBy: user.username, userId: user.id, updatedAt: now };
        await tx.insert(schema.zohoItemMap).values({ skuId: r.ourId, ...v }).onConflictDoUpdate({ target: schema.zohoItemMap.skuId, set: v });
      }
    }
  });
}

/** zoho_mapping.csv: Type (vendor | item), Our_ID (Distributor_ID or SKU_ID), Zoho_ID. Pure. */
export function parseMappingCsv(csv: string, known: { distributors: Set<string>; skus: Set<string> }) {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const errors: string[] = [];
  const missing = ["Type", "Our_ID", "Zoho_ID"].filter((c) => !parsed.meta.fields?.includes(c));
  if (missing.length) return { rows: [], errors: [`Missing column(s): ${missing.join(", ")}`] };
  const rows: { type: "vendor" | "item"; ourId: string; zohoId: string }[] = [];
  parsed.data.forEach((raw, i) => {
    const line = i + 2;
    const type = (raw.Type ?? "").trim().toLowerCase();
    const ourId = (raw.Our_ID ?? "").trim();
    const zohoId = (raw.Zoho_ID ?? "").trim();
    if (type !== "vendor" && type !== "item") return errors.push(`Row ${line}: Type must be vendor or item.`);
    if (!ourId || !zohoId) return errors.push(`Row ${line}: Our_ID and Zoho_ID are required.`);
    if (type === "vendor" && !known.distributors.has(ourId)) return errors.push(`Row ${line}: unknown distributor ${ourId}.`);
    if (type === "item" && !known.skus.has(ourId)) return errors.push(`Row ${line}: unknown SKU ${ourId}.`);
    rows.push({ type, ourId, zohoId });
  });
  return { rows, errors };
}

/** Suggested matches: Zoho item SKU = our SKU_ID; Zoho vendor name = distributor name (ignoring case). Pure. */
export function suggestMappings(
  zoho: { vendors: ZohoVendor[]; items: ZohoItem[] },
  ours: { distributors: { distributorId: string; name: string }[]; skus: { skuId: string }[] },
) {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const vendorByName = new Map(zoho.vendors.map((v) => [norm(v.contact_name), v]));
  const itemBySku = new Map(zoho.items.filter((i) => i.sku).map((i) => [i.sku!.trim(), i]));
  return {
    vendors: ours.distributors.flatMap((d) => {
      const v = vendorByName.get(norm(d.name));
      return v ? [{ type: "vendor" as const, ourId: d.distributorId, zohoId: v.contact_id, zohoName: v.contact_name }] : [];
    }),
    items: ours.skus.flatMap((s) => {
      const i = itemBySku.get(s.skuId);
      return i ? [{ type: "item" as const, ourId: s.skuId, zohoId: i.item_id, zohoName: i.name }] : [];
    }),
  };
}
