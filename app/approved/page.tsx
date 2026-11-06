import Link from "next/link";
import { StatusBadge } from "@/components/badges";
import { DownloadIcon, TruckIcon } from "@/components/icons";
import { getDb } from "@/lib/db";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { getApprovedOrders } from "@/lib/review";
import { getLatestRun } from "@/lib/run-engine";
import { requirePage } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ApprovedPage() {
  await requirePage("viewApproved");
  const db = await getDb();
  const run = await getLatestRun(db);
  const orders = run ? await getApprovedOrders(db, run.id) : [];
  const total = orders.reduce((a, o) => a + (o.finalQuantity ?? 0), 0);

  // Orders come sorted by distributor; group them for procurement.
  const groups = new Map<string, typeof orders>();
  for (const o of orders) {
    const key = o.distributorId ?? "unknown";
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }

  return (
    <>
      <div className="page-head">
        <div>
          {run && (
            <div className="eyebrow">
              Week {run.nowWeek} · Run #{run.id}
            </div>
          )}
          <h1>Approved orders</h1>
          <p className="muted">
            Approved reorders ready for procurement. These are not sent to Zoho yet; download the CSV instead.
          </p>
        </div>
        {orders.length > 0 && (
          <a className="button" href="/approved/export">
            <DownloadIcon size={16} /> Download CSV
          </a>
        )}
      </div>

      {orders.length === 0 ? (
        <div className="card empty">
          <div className="empty-icon tone-accent">
            <TruckIcon size={22} />
          </div>
          <strong>No approved orders yet</strong>
          <p>
            Approve recommendations on the <Link href="/review">Review</Link> page and they will appear here, grouped by
            distributor.
          </p>
        </div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <span className="kpi-label">Order lines</span>
              <span className="kpi-value">{orders.length}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Distributors</span>
              <span className="kpi-value">{groups.size}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Total units</span>
              <span className="kpi-value">{fmtInt(total)}</span>
            </div>
          </div>

          {[...groups.values()].map((list) => {
            const first = list[0];
            const subtotal = list.reduce((a, o) => a + (o.finalQuantity ?? 0), 0);
            return (
              <div key={first.distributorId ?? "unknown"} className="card">
                <div className="group-head">
                  <div>
                    <h2>{first.distributorName ?? first.distributorId ?? "Unknown distributor"}</h2>
                    <div className="muted small">{first.region}</div>
                  </div>
                  <span className="badge no-dot tone-ok">{fmtInt(subtotal)} units</span>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="num">Recommended</th>
                        <th className="num">Final qty</th>
                        <th>Status</th>
                        <th>Approved by</th>
                        <th>When</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((o) => (
                        <tr key={o.recommendationId}>
                          <td>
                            <Link href={`/sku/${o.skuId}`} className="product-name">
                              {o.skuName ?? o.skuId}
                            </Link>
                            <div className="product-meta">{o.skuId}</div>
                          </td>
                          <td className="num">{fmtInt(o.recommendedQuantity)}</td>
                          <td className="num">
                            <strong>{fmtInt(o.finalQuantity)}</strong>{" "}
                            <span className="muted small">{o.unitOfMeasure}</span>
                          </td>
                          <td>
                            <StatusBadge status={o.status} />
                          </td>
                          <td>{o.reviewedBy}</td>
                          <td className="muted">{fmtDateTime(o.reviewedAt)}</td>
                          <td className="muted">{o.reviewNote}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
