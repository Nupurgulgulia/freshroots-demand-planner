// Replaces the open-PO snapshot with Zoho Inventory's open purchase orders. Used by the
// "Sync from Zoho" button and by the scheduled job.

import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { replaceOpenPurchaseOrders } from "@/lib/data/load";
import { fetchOpenPurchaseOrders, type ZohoConfig } from "./inventory";
import { toPurchaseOrderLines } from "./purchase-orders";

export async function syncOpenPosFromZoho(db: Db, config: ZohoConfig, actor: { username: string; id: number | null }) {
  const pos = await fetchOpenPurchaseOrders(config);
  const { lines, skippedNoSku } = toPurchaseOrderLines(pos);
  await db.transaction((tx) => replaceOpenPurchaseOrders(tx as unknown as Db, lines, "zoho"));
  await db.insert(schema.uploads).values({
    dataset: "open_purchase_orders",
    fileName: "Zoho Inventory sync",
    rowCount: lines.length,
    uploadedBy: actor.username,
    userId: actor.id,
  });
  const known = new Set((await db.select({ id: schema.skus.skuId }).from(schema.skus)).map((r) => r.id));
  const unknownSkus = [...new Set(lines.map((l) => l.skuId).filter((id) => !known.has(id)))];
  return { poCount: pos.length, lineCount: lines.length, unknownSkus, skippedNoSku };
}
