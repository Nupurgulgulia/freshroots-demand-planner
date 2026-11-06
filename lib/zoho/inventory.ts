// Zoho Inventory API client: reads purchase orders, vendors and items, and creates DRAFT purchase
// orders. Server-only; credentials come from env vars. It never marks a purchase order as issued:
// the "Mark as Issued" endpoint (POST /purchaseorders/{id}/status/issued) is deliberately not wrapped.
//
// Setup (once): create a "Self Client" in the Zoho API console for your data centre, generate a grant
// code with scopes ZohoInventory.purchaseorders.READ, ZohoInventory.purchaseorders.CREATE,
// ZohoInventory.items.READ and ZohoInventory.contacts.READ, exchange it for a refresh token, then set
// ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID and (optionally) ZOHO_DC.
// ZOHO_API_BASE / ZOHO_ACCOUNTS_BASE point the client at the local mock server instead.

import { isOpenZohoPo, type ZohoPurchaseOrder } from "./purchase-orders";

export interface ZohoConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  orgId: string;
  /** Data-centre domain suffix: "in" (India, default), "com", "eu", "com.au", ... */
  dc: string;
  /** e.g. https://www.zohoapis.in (default from dc), or the mock server. */
  apiBase: string;
  /** e.g. https://accounts.zoho.in (default from dc), or the mock server. */
  accountsBase: string;
}

export function zohoConfig(env: Record<string, string | undefined> = process.env): ZohoConfig | null {
  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID, ZOHO_DC } = env;
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN || !ZOHO_ORG_ID) return null;
  const dc = ZOHO_DC || "in";
  return {
    clientId: ZOHO_CLIENT_ID,
    clientSecret: ZOHO_CLIENT_SECRET,
    refreshToken: ZOHO_REFRESH_TOKEN,
    orgId: ZOHO_ORG_ID,
    dc,
    apiBase: (env.ZOHO_API_BASE || `https://www.zohoapis.${dc}`).replace(/\/$/, ""),
    accountsBase: (env.ZOHO_ACCOUNTS_BASE || `https://accounts.zoho.${dc}`).replace(/\/$/, ""),
  };
}

export const zohoConfigured = () => zohoConfig() != null;

/** Feature flag for creating draft POs. Off unless ZOHO_ORDERING_ENABLED is "1" or "true". */
export const zohoOrderingEnabled = (env: Record<string, string | undefined> = process.env) =>
  ["1", "true", "yes"].includes((env.ZOHO_ORDERING_ENABLED ?? "").trim().toLowerCase());

/**
 * `definite` means Zoho answered and refused (nothing was created), so a retry is safe.
 * Without it the request may or may not have reached Zoho (network error, timeout).
 */
export class ZohoApiError extends Error {
  constructor(
    message: string,
    readonly definite: boolean,
  ) {
    super(message);
  }
}

async function accessToken(c: ZohoConfig): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: c.refreshToken,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: "refresh_token",
  });
  let res: Response;
  try {
    res = await fetch(`${c.accountsBase}/oauth/v2/token`, { method: "POST", body: params });
  } catch (err) {
    throw new ZohoApiError(`Couldn't reach Zoho to sign in: ${(err as Error).message}`, true);
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !body.access_token) {
    throw new ZohoApiError(`Zoho sign-in failed (${body.error ?? res.status}). Check the ZOHO_* settings.`, true);
  }
  return body.access_token;
}

async function request<T>(
  c: ZohoConfig,
  token: string,
  method: "GET" | "POST",
  path: string,
  query: Record<string, string> = {},
  json?: unknown,
): Promise<T> {
  const url = new URL(`${c.apiBase}/inventory/v1/${path}`);
  url.searchParams.set("organization_id", c.orgId);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        ...(json ? { "Content-Type": "application/json" } : {}),
      },
      body: json ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    // A GET is always safe to repeat; a POST might have reached Zoho before the connection failed.
    throw new ZohoApiError(`Couldn't reach Zoho: ${(err as Error).message}`, method === "GET");
  }
  const body = (await res.json().catch(() => null)) as (T & { code?: number; message?: string }) | null;
  if (!body) throw new ZohoApiError(`Zoho returned an unreadable response (HTTP ${res.status}).`, method === "GET" || res.status < 500);
  if (!res.ok || (body.code !== undefined && body.code !== 0)) {
    throw new ZohoApiError(`Zoho refused the request: ${body.message ?? `HTTP ${res.status}`} (code ${body.code ?? "?"})`, res.status < 500);
  }
  return body;
}

const MAX_PAGES = 50;
const DETAIL_CONCURRENCY = 4;

async function listAll<T>(c: ZohoConfig, token: string, path: string, key: string, query: Record<string, string> = {}) {
  const out: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await request<Record<string, unknown> & { page_context?: { has_more_page?: boolean } }>(
      c,
      token,
      "GET",
      path,
      { ...query, page: String(page), per_page: "200" },
    );
    out.push(...((body[key] as T[] | undefined) ?? []));
    if (!body.page_context?.has_more_page) break;
  }
  return out;
}

/** All open purchase orders with their line items. */
export async function fetchOpenPurchaseOrders(c: ZohoConfig): Promise<ZohoPurchaseOrder[]> {
  const token = await accessToken(c);
  // The list endpoint has no line items, so list first, then fetch each open PO's details.
  const open = (await listAll<ZohoPurchaseOrder>(c, token, "purchaseorders", "purchaseorders")).filter(isOpenZohoPo);
  const detailed: ZohoPurchaseOrder[] = [];
  for (let i = 0; i < open.length; i += DETAIL_CONCURRENCY) {
    const batch = open.slice(i, i + DETAIL_CONCURRENCY);
    const results = await Promise.all(
      batch.map((po) =>
        request<{ purchaseorder?: ZohoPurchaseOrder }>(c, token, "GET", `purchaseorders/${po.purchaseorder_id}`).then(
          (b) => b.purchaseorder ?? po,
        ),
      ),
    );
    detailed.push(...results);
  }
  return detailed;
}

export interface ZohoVendor {
  contact_id: string;
  contact_name: string;
}
export interface ZohoItem {
  item_id: string;
  name: string;
  sku?: string | null;
}

/** Vendors and items, used to suggest mappings. */
export async function fetchVendorsAndItems(c: ZohoConfig) {
  const token = await accessToken(c);
  const [vendors, items] = await Promise.all([
    listAll<ZohoVendor>(c, token, "contacts", "contacts", { contact_type: "vendor" }),
    listAll<ZohoItem>(c, token, "items", "items"),
  ]);
  return { vendors, items };
}

export interface DraftPurchaseOrderInput {
  vendorId: string;
  /** Our stable reference, e.g. FR-R35-DIST002; also used to spot duplicates. */
  referenceNumber: string;
  date: string; // YYYY-MM-DD
  lineItems: { itemId: string; quantity: number }[];
  notes?: string;
}

/**
 * Creates ONE purchase order in Zoho. New purchase orders are drafts until someone marks them as
 * issued in Zoho; this app never does. Zoho numbers the PO itself; our reference goes in
 * reference_number. No price is sent: Zoho uses each item's own purchase rate.
 */
export async function createDraftPurchaseOrder(c: ZohoConfig, input: DraftPurchaseOrderInput) {
  const token = await accessToken(c);
  const body = await request<{
    purchaseorder?: { purchaseorder_id: string; purchaseorder_number: string; status?: string };
    purchase_order?: { purchaseorder_id: string; purchaseorder_number: string; status?: string };
  }>(c, token, "POST", "purchaseorders", {}, {
    vendor_id: input.vendorId,
    reference_number: input.referenceNumber,
    date: input.date,
    notes: input.notes,
    line_items: input.lineItems.map((l) => ({ item_id: l.itemId, quantity: l.quantity })),
  });
  const po = body.purchaseorder ?? body.purchase_order;
  if (!po?.purchaseorder_id) throw new ZohoApiError("Zoho didn't return the new purchase order's id.", false);
  return { purchaseorderId: po.purchaseorder_id, purchaseorderNumber: po.purchaseorder_number, status: po.status ?? "draft" };
}
