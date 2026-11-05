// Joins master, sales and stock rows into per-SKU engine inputs. Pure.

import type { SkuInput } from "./engine";
import { latestWeek } from "./weeks";

export interface SourceData {
  skus: {
    skuId: string;
    perishability: string | null;
    standardReorderQty: number | null;
    distributorId: string | null;
  }[];
  distributors: { distributorId: string; status: string }[];
  sales: { skuId: string; week: string; unitsSold: number }[];
  inventory: { skuId: string; location: string; unitsOnHand: number; asOfDate: string }[];
  calendar: { yearMonth: string; isFestivalMonth: boolean }[];
  /** Purchase order lines; only open ones count (see isOpenPoStatus). Optional. */
  openPurchaseOrders?: { skuId: string; orderedQty: number; receivedQty: number; status: string }[];
}

/** Statuses of a PO that has been sent to the supplier but not fully received. */
const OPEN_PO_STATUSES = new Set(["open", "issued", "partiallyreceived"]);

export function isOpenPoStatus(status: string): boolean {
  return OPEN_PO_STATUSES.has(status.toLowerCase().replace(/[\s_-]/g, ""));
}

export function buildEngineInputs(data: SourceData) {
  const distributorStatus = new Map(data.distributors.map((d) => [d.distributorId, d.status]));
  const salesBySku = groupBy(data.sales, (s) => s.skuId);
  const inventoryBySku = groupBy(data.inventory, (r) => r.skuId);
  const onOrderBySku = new Map<string, number>();
  for (const po of data.openPurchaseOrders ?? []) {
    if (!isOpenPoStatus(po.status)) continue;
    const outstanding = Math.max(0, po.orderedQty - po.receivedQty);
    onOrderBySku.set(po.skuId, (onOrderBySku.get(po.skuId) ?? 0) + outstanding);
  }

  const skus: SkuInput[] = data.skus.map((s) => ({
    skuId: s.skuId,
    perishability: s.perishability,
    standardReorderQty: s.standardReorderQty,
    distributorStatus: s.distributorId ? (distributorStatus.get(s.distributorId) ?? null) : null,
    sales: (salesBySku.get(s.skuId) ?? []).map(({ week, unitsSold }) => ({ week, unitsSold })),
    inventory: (inventoryBySku.get(s.skuId) ?? []).map(({ location, unitsOnHand, asOfDate }) => ({
      location,
      unitsOnHand,
      asOfDate,
    })),
    unitsOnOrder: onOrderBySku.get(s.skuId) ?? 0,
  }));

  return {
    skus,
    nowWeek: latestWeek(data.sales.map((s) => s.week)),
    festivalCalendar: new Map(data.calendar.map((c) => [c.yearMonth, c.isFestivalMonth])),
  };
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}
