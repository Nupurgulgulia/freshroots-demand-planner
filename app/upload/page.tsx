import { desc } from "drizzle-orm";
import { UploadForm, ZohoSyncForm } from "@/components/forms";
import { DATASET_NAMES, OPTIONAL_DATASETS, datasetColumns } from "@/lib/data/csv";
import { getDb, schema } from "@/lib/db";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { isOpenPoStatus } from "@/lib/rules/inputs";
import { requirePage } from "@/lib/session";
import { zohoConfigured } from "@/lib/zoho/inventory";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  await requirePage("upload");
  const db = await getDb();
  const [uploads, pos] = await Promise.all([
    db.select().from(schema.uploads).orderBy(desc(schema.uploads.id)).limit(20),
    db.select().from(schema.openPurchaseOrders),
  ]);
  const openLines = pos.filter((p) => isOpenPoStatus(p.status));
  const unitsOnOrder = openLines.reduce((a, p) => a + Math.max(0, p.orderedQty - p.receivedQty), 0);
  const poCount = new Set(openLines.map((p) => p.poNumber)).size;
  const lastLoad = pos.reduce<Date | null>((a, p) => (!a || p.loadedAt > a ? p.loadedAt : a), null);
  const source = pos[0]?.source;
  const zoho = zohoConfigured();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Upload data</h1>
          <p className="muted">
            Each file is checked in full; if any row is invalid, nothing from that file is saved. Master data, sales and
            the calendar are updated by key. current_inventory and open_purchase_orders replace the previous snapshot.
          </p>
        </div>
      </div>

      <div className="card">
        <UploadForm datasets={DATASET_NAMES} />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Open purchase orders</h2>
            <div className="muted small">
              Units ordered but not yet received count towards weeks of cover, so stock that&apos;s already on its way
              isn&apos;t ordered twice.
            </div>
          </div>
          <span className={`badge no-dot ${zoho ? "tone-ok" : "tone-neutral"}`}>
            {zoho ? "Zoho Inventory connected" : "Zoho not connected"}
          </span>
        </div>
        <div className="stat-tiles">
          <div className="stat">
            <div className="stat-label">Open POs</div>
            <div className="stat-value">{fmtInt(poCount)}</div>
            <div className="stat-note">{fmtInt(openLines.length)} lines</div>
          </div>
          <div className="stat">
            <div className="stat-label">Units on order</div>
            <div className="stat-value">{fmtInt(unitsOnOrder)}</div>
            <div className="stat-note">ordered minus received</div>
          </div>
          <div className="stat">
            <div className="stat-label">Last loaded</div>
            <div className="stat-value" style={{ fontSize: 15 }}>
              {lastLoad ? fmtDateTime(lastLoad) : "Never"}
            </div>
            <div className="stat-note">
              {source === "zoho" ? "from Zoho Inventory" : source === "csv" ? "from a CSV upload" : "no POs loaded yet"}
            </div>
          </div>
        </div>
        <ZohoSyncForm configured={zoho} />
        {!zoho && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            Until Zoho is connected, upload an <strong>open_purchase_orders.csv</strong> above (an example is in{" "}
            <code>data/samples</code>). Status must be Open, Issued or Partially Received for a line to count. The
            README explains how to connect Zoho.
          </p>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Expected files and columns</h2>
          <ul className="dataset-list">
            {DATASET_NAMES.map((d) => (
              <li key={d}>
                <strong>{d}.csv</strong>
                {OPTIONAL_DATASETS.includes(d) && <span className="tag" style={{ marginLeft: 6 }}>optional</span>}
                <div>
                  <code>{datasetColumns(d).join(", ")}</code>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>Recent uploads</h2>
          {uploads.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Dataset</th>
                    <th className="num">Rows</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {uploads.map((u) => (
                    <tr key={u.id}>
                      <td className="muted">{fmtDateTime(u.uploadedAt)}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{u.dataset}</div>
                        <div className="product-meta">{u.fileName}</div>
                      </td>
                      <td className="num">{u.rowCount}</td>
                      <td>{u.uploadedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
