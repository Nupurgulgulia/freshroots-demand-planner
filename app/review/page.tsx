import Link from "next/link";
import { FlagBadge, StatusBadge, actionText } from "@/components/badges";
import { ReviewForm } from "@/components/forms";
import { getDb } from "@/lib/db";
import { fmt1, fmtInt } from "@/lib/format";
import { getLatestRun, getRunRecommendations } from "@/lib/run-engine";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const db = await getDb();
  const run = await getLatestRun(db);
  if (!run) {
    return (
      <>
        <h1>Review</h1>
        <p className="muted">No run yet.</p>
      </>
    );
  }
  const rows = (await getRunRecommendations(db, run.id)).filter((r) => r.rec.action !== "NONE");
  // Exceptions first, then by SKU.
  rows.sort((a, b) => Number(b.rec.isException) - Number(a.rec.isException) || a.rec.skuId.localeCompare(b.rec.skuId));
  const pending = rows.filter((r) => r.rec.status === "PENDING");
  const decided = rows.filter((r) => r.rec.status !== "PENDING");

  return (
    <>
      <h1>Review</h1>
      <p className="muted">
        Run #{run.id}, week {run.nowWeek}. Approve, edit the quantity, or reject each recommendation. Every decision is
        saved to the audit log.
      </p>

      <h2>Pending ({pending.length})</h2>
      {pending.length === 0 ? (
        <p className="muted">Nothing waiting.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Flag</th>
                <th>Recommended</th>
                <th className="num">Cover (wks)</th>
                <th>Reason / brief</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {pending.map(({ rec, sku, ai, evaluation: e }) => (
                <tr key={rec.id}>
                  <td>
                    <Link href={`/sku/${rec.skuId}`}>{rec.skuId}</Link>
                    <div className="muted">{sku?.name}</div>
                  </td>
                  <td>
                    <FlagBadge flag={rec.flag} />
                  </td>
                  <td>{actionText(rec.action, rec.quantity)}</td>
                  <td className="num">{fmt1(e.weeksOfCover)}</td>
                  <td className="reason">
                    {ai?.brief ?? ai?.reason ?? rec.reason}
                    {!ai && e.exceptionReasons.length > 0 && (
                      <ul>
                        {e.exceptionReasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    <ReviewForm recommendationId={rec.id} quantity={rec.quantity} action={rec.action} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ marginTop: 24 }}>Decided ({decided.length})</h2>
      {decided.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Recommended</th>
                <th>Decision</th>
                <th className="num">Final qty</th>
                <th>By</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {decided.map(({ rec }) => (
                <tr key={rec.id}>
                  <td>
                    <Link href={`/sku/${rec.skuId}`}>{rec.skuId}</Link>
                  </td>
                  <td>{actionText(rec.action, rec.quantity)}</td>
                  <td>
                    <StatusBadge status={rec.status} />
                  </td>
                  <td className="num">{fmtInt(rec.finalQuantity)}</td>
                  <td>{rec.reviewedBy}</td>
                  <td>{rec.reviewNote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
