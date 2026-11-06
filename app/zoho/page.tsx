import { ImportMappingForm, SuggestMappingForm, ZohoMappingForm } from "@/components/zoho-forms";
import { getDb, schema } from "@/lib/db";
import { requirePage } from "@/lib/session";
import { zohoConfigured, zohoOrderingEnabled } from "@/lib/zoho/inventory";

export const dynamic = "force-dynamic";

export default async function ZohoMappingPage() {
  await requirePage("manageZohoMapping");
  const db = await getDb();
  const [distributors, skus, vendorMap, itemMap] = await Promise.all([
    db.select().from(schema.distributors).orderBy(schema.distributors.distributorId),
    db.select().from(schema.skus).orderBy(schema.skus.skuId),
    db.select().from(schema.zohoVendorMap),
    db.select().from(schema.zohoItemMap),
  ]);
  const vendors = new Map(vendorMap.map((v) => [v.distributorId, v]));
  const items = new Map(itemMap.map((i) => [i.skuId, i]));
  const mappedVendors = distributors.filter((d) => vendors.has(d.distributorId)).length;
  const mappedItems = skus.filter((s) => items.has(s.skuId)).length;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Zoho Inventory</div>
          <h1>Zoho mapping</h1>
          <p className="muted">
            Link each distributor to its Zoho vendor and each SKU to its Zoho item, so approved orders can go to Zoho as
            draft purchase orders. Each SKU is ordered from the distributor in the SKU master.
          </p>
        </div>
        <div className="row">
          <span className={`badge no-dot ${mappedVendors === distributors.length ? "tone-ok" : "tone-overstock"}`}>
            {mappedVendors}/{distributors.length} vendors
          </span>
          <span className={`badge no-dot ${mappedItems === skus.length ? "tone-ok" : "tone-overstock"}`}>
            {mappedItems}/{skus.length} items
          </span>
        </div>
      </div>

      {!zohoOrderingEnabled() && (
        <div className="status status-warning" role="status" style={{ marginBottom: 20 }}>
          Sending to Zoho is switched off (ZOHO_ORDERING_ENABLED), so the mapping isn&apos;t used yet.
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <h2>Fill gaps from Zoho</h2>
          <p className="muted small">
            Matches a Zoho item when its SKU equals our SKU_ID, and a Zoho vendor when its name equals the distributor
            name. Only empty boxes are filled; check them before sending.
          </p>
          <SuggestMappingForm enabled={zohoConfigured()} />
        </div>
        <div className="card">
          <h2>Import a CSV</h2>
          <p className="muted small">
            <code>zoho_mapping.csv</code> with columns <code>Type, Our_ID, Zoho_ID</code>. Type is <code>vendor</code>{" "}
            (Our_ID = Distributor_ID) or <code>item</code> (Our_ID = SKU_ID). If any row is wrong, nothing is saved.
          </p>
          <ImportMappingForm />
        </div>
      </div>

      <ZohoMappingForm
        vendors={distributors.map((d) => ({
          ourId: d.distributorId,
          label: d.name,
          meta: d.region,
          zohoId: vendors.get(d.distributorId)?.zohoVendorId ?? "",
          zohoName: vendors.get(d.distributorId)?.zohoVendorName ?? null,
        }))}
        items={skus.map((s) => ({
          ourId: s.skuId,
          label: s.name,
          zohoId: items.get(s.skuId)?.zohoItemId ?? "",
          zohoName: items.get(s.skuId)?.zohoItemName ?? null,
        }))}
      />
    </>
  );
}
