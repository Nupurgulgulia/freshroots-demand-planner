// A small fake Zoho Inventory for tests and local development. It speaks just enough of the real API
// (OAuth token, contacts, items, purchase orders) for the app's real client code to run against it.
// Start it with `npm run mock:zoho`, then point ZOHO_API_BASE and ZOHO_ACCOUNTS_BASE at it.
//
// Fixtures: one vendor per sample distributor (DIST001-DIST004) and one item per sample SKU
// (SKU001-SKU015). Vendor "zv-fail" always refuses a purchase order, to try out failures and retry.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface MockPurchaseOrder {
  purchaseorder_id: string;
  purchaseorder_number: string;
  reference_number: string;
  vendor_id: string;
  date: string;
  status: string;
  line_items: { item_id: string; sku: string; quantity: number; quantity_received: number }[];
}

export const MOCK_VENDORS = [
  { contact_id: "zv-1001", contact_name: "NutriFlow Distributors" },
  { contact_id: "zv-1002", contact_name: "GrainPath Logistics" },
  { contact_id: "zv-1003", contact_name: "PeakSource Supply" },
  { contact_id: "zv-1004", contact_name: "Meridian Trade Co." },
  { contact_id: "zv-fail", contact_name: "Always Refuses Ltd (test)" },
];

export const MOCK_ITEMS = Array.from({ length: 15 }, (_, i) => {
  const n = String(i + 1).padStart(3, "0");
  return { item_id: `zi-${n}`, name: `Freshroots item ${n}`, sku: `SKU${n}`, is_purchase_item: true };
});

export function createMockZoho() {
  const purchaseOrders: MockPurchaseOrder[] = [];
  const calls: { method: string; path: string }[] = [];
  let issueAttempts = 0;
  let next = 1;

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => resolve(data));
    });
  const page = <T,>(key: string, items: T[]) => ({ code: 0, message: "success", [key]: items, page_context: { has_more_page: false } });

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    calls.push({ method: req.method ?? "GET", path: url.pathname });

    if (url.pathname === "/oauth/v2/token" && req.method === "POST") {
      return send(res, 200, { access_token: "mock-access-token", expires_in: 3600 });
    }
    if (!url.pathname.startsWith("/inventory/v1/")) return send(res, 404, { code: 404, message: "Not found" });
    if (req.headers.authorization !== "Zoho-oauthtoken mock-access-token") {
      return send(res, 401, { code: 57, message: "You are not authorized to perform this operation" });
    }
    if (!url.searchParams.get("organization_id")) return send(res, 400, { code: 6024, message: "organization_id is required" });

    const path = url.pathname.replace("/inventory/v1/", "");
    if (req.method === "GET" && path === "contacts") return send(res, 200, page("contacts", MOCK_VENDORS));
    if (req.method === "GET" && path === "items") return send(res, 200, page("items", MOCK_ITEMS));
    if (req.method === "GET" && path === "purchaseorders") {
      return send(res, 200, page("purchaseorders", purchaseOrders.map(({ line_items, ...po }) => po)));
    }
    const detail = /^purchaseorders\/([^/]+)$/.exec(path);
    if (req.method === "GET" && detail) {
      const po = purchaseOrders.find((p) => p.purchaseorder_id === detail[1]);
      return po ? send(res, 200, { code: 0, purchaseorder: po }) : send(res, 404, { code: 1002, message: "Not found" });
    }
    // The app must never do this; the mock refuses and counts it so tests can check.
    if (/^purchaseorders\/[^/]+\/status\//.test(path)) {
      issueAttempts++;
      return send(res, 400, { code: 9999, message: "Mock: changing PO status is not allowed from the app" });
    }
    if (req.method === "POST" && path === "purchaseorders") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.vendor_id || !MOCK_VENDORS.some((v) => v.contact_id === body.vendor_id)) {
        return send(res, 400, { code: 1004, message: "Vendor does not exist" });
      }
      if (body.vendor_id === "zv-fail") return send(res, 400, { code: 1000, message: "Mock vendor refuses all orders" });
      const lines = Array.isArray(body.line_items) ? body.line_items : [];
      if (lines.length === 0) return send(res, 400, { code: 1001, message: "Line items are required" });
      for (const l of lines) {
        const item = MOCK_ITEMS.find((i) => i.item_id === l.item_id);
        if (!item) return send(res, 400, { code: 29009, message: "Purchase order cannot be created for a non-purchase item" });
        if (!(Number(l.quantity) > 0)) return send(res, 400, { code: 1003, message: "Quantity must be more than 0" });
      }
      const po: MockPurchaseOrder = {
        purchaseorder_id: `zpo-${String(next).padStart(4, "0")}`,
        purchaseorder_number: `PO-${String(next).padStart(5, "0")}`,
        reference_number: String(body.reference_number ?? ""),
        vendor_id: body.vendor_id,
        date: body.date,
        status: "draft",
        line_items: lines.map((l: { item_id: string; quantity: number }) => ({
          item_id: l.item_id,
          sku: MOCK_ITEMS.find((i) => i.item_id === l.item_id)!.sku,
          quantity: Number(l.quantity),
          quantity_received: 0,
        })),
      };
      next++;
      purchaseOrders.push(po);
      return send(res, 201, { code: 0, message: "Purchase order has been created.", purchaseorder: po });
    }
    return send(res, 404, { code: 404, message: `Mock doesn't handle ${req.method} ${path}` });
  });

  return {
    server,
    purchaseOrders,
    calls,
    get issueAttempts() {
      return issueAttempts;
    },
    /** Starts on the given port (0 = any free port) and returns the base URL. */
    listen(port = 0) {
      return new Promise<string>((resolve) => {
        server.listen(port, "127.0.0.1", () => {
          const addr = server.address();
          resolve(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : port}`);
        });
      });
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
