// Turns Zoho Inventory purchase-order JSON into our open-PO lines. Pure.
//
// Field names follow Zoho Inventory's API v1 (purchaseorder_number, status, delivery_date,
// line_items[].sku / quantity / quantity_received). They have not yet been checked against a
// live Zoho organisation, so the parser is deliberately tolerant of missing fields.

import type { PurchaseOrderLine } from "@/lib/data/load";
import { isOpenPoStatus } from "@/lib/rules/inputs";

export interface ZohoLineItem {
  sku?: string | null;
  quantity?: number | string | null;
  quantity_received?: number | string | null;
  quantity_cancelled?: number | string | null;
}

export interface ZohoPurchaseOrder {
  purchaseorder_id?: string;
  purchaseorder_number?: string;
  status?: string | null;
  received_status?: string | null;
  delivery_date?: string | null;
  expected_delivery_date?: string | null;
  line_items?: ZohoLineItem[];
}

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** The PO's status in our terms: partially received POs are reported separately by Zoho. */
export function zohoStatus(po: ZohoPurchaseOrder): string {
  const received = (po.received_status ?? "").toLowerCase();
  if (received === "partially_received") return "Partially Received";
  if (received === "received") return "Received";
  return po.status ?? "";
}

export function isOpenZohoPo(po: ZohoPurchaseOrder): boolean {
  return isOpenPoStatus(zohoStatus(po));
}

export interface ParsedZohoPos {
  lines: PurchaseOrderLine[];
  /** Line items without a SKU code, which can't be matched to our SKUs. */
  skippedNoSku: number;
}

/** Lines of open POs, one per PO + SKU (repeat lines for the same SKU are added together). */
export function toPurchaseOrderLines(pos: ZohoPurchaseOrder[]): ParsedZohoPos {
  const byKey = new Map<string, PurchaseOrderLine>();
  let skippedNoSku = 0;
  for (const po of pos) {
    if (!isOpenZohoPo(po)) continue;
    const poNumber = po.purchaseorder_number || po.purchaseorder_id || "";
    if (!poNumber) continue;
    const date = (po.delivery_date || po.expected_delivery_date || "").slice(0, 10);
    for (const item of po.line_items ?? []) {
      const skuId = (item.sku ?? "").trim();
      if (!skuId) {
        skippedNoSku++;
        continue;
      }
      const ordered = Math.max(0, num(item.quantity) - num(item.quantity_cancelled));
      const received = Math.min(ordered, num(item.quantity_received));
      const key = `${poNumber}|${skuId}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.orderedQty += ordered;
        existing.receivedQty += received;
      } else {
        byKey.set(key, {
          poNumber,
          skuId,
          orderedQty: ordered,
          receivedQty: received,
          expectedDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
          status: zohoStatus(po),
        });
      }
    }
  }
  return { lines: [...byKey.values()], skippedNoSku };
}
