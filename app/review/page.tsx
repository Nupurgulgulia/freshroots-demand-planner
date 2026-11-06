import Link from "next/link";
import { ActionText, CoverBar, FlagBadge, StatusBadge } from "@/components/badges";
import { ReviewForm } from "@/components/forms";
import { CheckIcon, SparkIcon } from "@/components/icons";
import { getDb } from "@/lib/db";
import { fmtInt } from "@/lib/format";
import { ROLE_LABELS, can } from "@/lib/permissions";
import { getLatestRun, getRunRecommendations } from "@/lib/run-engine";
import { requirePage } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const user = await requirePage("viewReview");
  const canDecide = can(user.role, "review");
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
      <div className="page-head">
        <div>
          <div className="eyebrow">Week {run.nowWeek} · Run #{run.id}</div>
          <h1>Review recommendations</h1>
          <p className="muted">
            Approve, edit the quantity or reject each one. Every decision is saved to the audit log.
          </p>
        </div>
        <div className="row">
          <span className="badge no-dot tone-accent">{pending.length} pending</span>
          <span className="badge no-dot tone-ok">{decided.length} decided</span>
        </div>
      </div>

      <div className="reviewer-bar">
        <span className="avatar" aria-hidden="true">
          {user.username.slice(0, 2).toUpperCase()}
        </span>
        {canDecide ? (
          <span>
            Reviewing as <strong>{user.username}</strong>. Every decision is recorded against your account.
          </span>
        ) : (
          <span>
            You're signed in as <strong>{user.username}</strong> ({ROLE_LABELS[user.role]}). This page is read-only
            for you; planners make the decisions.
          </span>
        )}
      </div>

      {pending.length === 0 ? (
        <div className="card empty">
          <div className="empty-icon tone-ok">
            <CheckIcon size={22} />
          </div>
          <strong>All caught up</strong>
          <p>
            Every recommendation in this run has a decision. Approved orders are on the{" "}
            <Link href="/approved">Approved orders</Link> page.
          </p>
        </div>
      ) : (
        <div className="review-list">
          {pending.map(({ rec, sku, ai, evaluation: e }) => (
            <div key={rec.id} className={`review-item ${rec.isException ? "is-exception" : ""}`}>
              <div>
                <Link href={`/sku/${rec.skuId}`} className="product-name">
                  {sku?.name ?? rec.skuId}
                </Link>
                <div className="product-meta">
                  {rec.skuId}
                  {e.perishability === "High" && " · Perishable"}
                </div>
                <div className="rec-line">
                  <FlagBadge flag={rec.flag} />
                  <ActionText action={rec.action} quantity={rec.quantity} />
                </div>
                <div className="cover-line">
                  <span className="muted small">Cover</span>
                  <CoverBar weeks={e.weeksOfCover} stockout={e.stockoutThresholdWeeks} overstock={e.overstockThresholdWeeks} />
                </div>
              </div>
              <div>
                <p className="brief">
                  {(ai?.brief || ai?.reason) && (
                    <span className="ai-tag">
                      <SparkIcon size={11} /> AI ·{" "}
                    </span>
                  )}
                  {ai?.brief ?? ai?.reason ?? rec.reason}
                </p>
                {!ai && e.exceptionReasons.length > 0 && (
                  <ul>
                    {e.exceptionReasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
              {canDecide ? (
                <ReviewForm recommendationId={rec.id} quantity={rec.quantity} action={rec.action} compact />
              ) : (
                <div className="muted small">Waiting for a planner's decision.</div>
              )}
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: 32 }}>Decided ({decided.length})</h2>
      {decided.length === 0 ? (
        <p className="muted">No decisions yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table stack-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Recommended</th>
                <th>Decision</th>
                <th className="num">Final qty</th>
                <th>By</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {decided.map(({ rec, sku }) => (
                <tr key={rec.id}>
                  <td data-label="Product">
                    <Link href={`/sku/${rec.skuId}`} className="product-name">
                      {sku?.name ?? rec.skuId}
                    </Link>
                    <div className="product-meta">{rec.skuId}</div>
                  </td>
                  <td data-label="Recommended">
                    <ActionText action={rec.action} quantity={rec.quantity} />
                  </td>
                  <td data-label="Decision">
                    <StatusBadge status={rec.status} />
                  </td>
                  <td data-label="Final qty" className="num">{fmtInt(rec.finalQuantity)}</td>
                  <td data-label="By">{rec.reviewedBy}</td>
                  <td data-label="Note" className="muted">{rec.reviewNote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
