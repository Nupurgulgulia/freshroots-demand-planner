// Zoho Inventory API client: reads purchase orders. Server-only; credentials come from env vars.
//
// Setup (once): create a "Self Client" in the Zoho API console for your data centre, generate a
// grant code with scope ZohoInventory.purchaseorders.READ, exchange it for a refresh token, then set
// ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID and (optionally) ZOHO_DC.

import { isOpenZohoPo, type ZohoPurchaseOrder } from "./purchase-orders";

export interface ZohoConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  orgId: string;
  /** Data-centre domain suffix: "in" (India, default), "com", "eu", "com.au", ... */
  dc: string;
}

export function zohoConfig(): ZohoConfig | null {
  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID, ZOHO_DC } = process.env;
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN || !ZOHO_ORG_ID) return null;
  return {
    clientId: ZOHO_CLIENT_ID,
    clientSecret: ZOHO_CLIENT_SECRET,
    refreshToken: ZOHO_REFRESH_TOKEN,
    orgId: ZOHO_ORG_ID,
    dc: ZOHO_DC || "in",
  };
}

export const zohoConfigured = () => zohoConfig() != null;

async function accessToken(c: ZohoConfig): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: c.refreshToken,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch(`https://accounts.zoho.${c.dc}/oauth/v2/token`, { method: "POST", body: params });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`Zoho sign-in failed (${body.error ?? res.status}). Check the ZOHO_* settings.`);
  }
  return body.access_token;
}

async function get<T>(c: ZohoConfig, token: string, path: string, query: Record<string, string> = {}): Promise<T> {
  const url = new URL(`https://www.zohoapis.${c.dc}/inventory/v1/${path}`);
  url.searchParams.set("organization_id", c.orgId);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  const body = (await res.json().catch(() => ({}))) as T & { code?: number; message?: string };
  if (!res.ok || (body.code !== undefined && body.code !== 0)) {
    throw new Error(`Zoho Inventory request failed: ${body.message ?? res.status}`);
  }
  return body;
}

const MAX_PAGES = 50;
const DETAIL_CONCURRENCY = 4;

/** All open purchase orders with their line items. */
export async function fetchOpenPurchaseOrders(c: ZohoConfig): Promise<ZohoPurchaseOrder[]> {
  const token = await accessToken(c);

  // The list endpoint has no line items, so list first, then fetch each open PO's details.
  const open: ZohoPurchaseOrder[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await get<{ purchaseorders?: ZohoPurchaseOrder[]; page_context?: { has_more_page?: boolean } }>(
      c,
      token,
      "purchaseorders",
      { page: String(page), per_page: "200" },
    );
    open.push(...(body.purchaseorders ?? []).filter(isOpenZohoPo));
    if (!body.page_context?.has_more_page) break;
  }

  const detailed: ZohoPurchaseOrder[] = [];
  for (let i = 0; i < open.length; i += DETAIL_CONCURRENCY) {
    const batch = open.slice(i, i + DETAIL_CONCURRENCY);
    const results = await Promise.all(
      batch.map((po) =>
        get<{ purchaseorder?: ZohoPurchaseOrder }>(c, token, `purchaseorders/${po.purchaseorder_id}`).then(
          (b) => b.purchaseorder ?? po,
        ),
      ),
    );
    detailed.push(...results);
  }
  return detailed;
}
