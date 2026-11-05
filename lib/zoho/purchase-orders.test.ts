import { describe, expect, it } from "vitest";
import { toPurchaseOrderLines, zohoStatus, type ZohoPurchaseOrder } from "./purchase-orders";

const po = (over: Partial<ZohoPurchaseOrder>): ZohoPurchaseOrder => ({
  purchaseorder_id: "1",
  purchaseorder_number: "PO-00001",
  status: "issued",
  delivery_date: "2026-11-20",
  line_items: [{ sku: "SKU001", quantity: 500, quantity_received: 0 }],
  ...over,
});

describe("Zoho purchase orders", () => {
  it("keeps open POs and drops draft, cancelled and fully received ones", () => {
    const { lines } = toPurchaseOrderLines([
      po({}),
      po({ purchaseorder_number: "PO-2", status: "draft" }),
      po({ purchaseorder_number: "PO-3", status: "cancelled" }),
      po({ purchaseorder_number: "PO-4", status: "issued", received_status: "received" }),
    ]);
    expect(lines).toEqual([
      {
        poNumber: "PO-00001",
        skuId: "SKU001",
        orderedQty: 500,
        receivedQty: 0,
        expectedDate: "2026-11-20",
        status: "issued",
      },
    ]);
  });

  it("reads partially received POs, cancelled quantities and string numbers", () => {
    const p = po({
      received_status: "partially_received",
      line_items: [{ sku: "SKU003", quantity: "300", quantity_received: "120", quantity_cancelled: "50" }],
    });
    expect(zohoStatus(p)).toBe("Partially Received");
    expect(toPurchaseOrderLines([p]).lines[0]).toMatchObject({ orderedQty: 250, receivedQty: 120 });
  });

  it("adds up repeat lines for the same SKU and counts lines without a SKU", () => {
    const { lines, skippedNoSku } = toPurchaseOrderLines([
      po({
        delivery_date: "",
        line_items: [
          { sku: "SKU001", quantity: 100 },
          { sku: "SKU001", quantity: 50, quantity_received: 10 },
          { sku: "", quantity: 70 },
          { quantity: 5 },
        ],
      }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ orderedQty: 150, receivedQty: 10, expectedDate: null });
    expect(skippedNoSku).toBe(2);
  });
});
