import Link from "next/link";
import { StatusBadge } from "@/components/badges";
import { getDb } from "@/lib/db";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { getApprovedOrders } from "@/lib/review";
import { getLatestRun } from "@/lib/run-engine";

export const dynamic = "force-dynamic";

export default async function ApprovedPage() {
  const db = await getDb();
  const run = await getLatestRun(db);
  const orders = run ? await getApprovedOrders(db, run.id) : [];
  const total = orders.reduce((a, o) => a + (o.finalQuantity ?? 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Approved orders</h1>
          <p className="muted">
            {run ? `Run #${run.id}, week ${run.nowWeek}. ` : ""}Approved reorders ready for procurement. These are not
            sent to Zoho yet; export the CSV instead.
          </p>
        </div>
        {orders.length > 0 && (
          <a className="button" href="/approved/export">
            Download CSV
          </a>
        )}
      </div>

      {orders.length === 0 ? (
        <p className="muted">
          No approved orders yet. Approve recommendations on the <Link href="/review">Review</Link> page.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Distributor</th>
                <th>SKU</th>
                <th>Name</th>
                <th className="num">Recommended</th>
                <th className="num">Final qty</th>
                <th>Status</th>
                <th>Approved by</th>
                <th>When</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.recommendationId}>
                  <td>
                    {o.distributorName ?? o.distributorId}
                    <div className="muted">{o.region}</div>
                  </td>
                  <td>
                    <Link href={`/sku/${o.skuId}`}>{o.skuId}</Link>
                  </td>
                  <td>{o.skuName}</td>
                  <td className="num">{fmtInt(o.recommendedQuantity)}</td>
                  <td className="num">
                    <strong>{fmtInt(o.finalQuantity)}</strong> {o.unitOfMeasure}
                  </td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td>{o.reviewedBy}</td>
                  <td>{fmtDateTime(o.reviewedAt)}</td>
                  <td>{o.reviewNote}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4}>
                  <strong>Total</strong>
                </td>
                <td className="num">
                  <strong>{fmtInt(total)}</strong>
                </td>
                <td colSpan={4} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
