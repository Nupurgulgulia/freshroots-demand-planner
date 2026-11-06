import Link from "next/link";
import { StatusBadge } from "@/components/badges";
import { ConfirmQuantityForm } from "@/components/forms";
import { DownloadIcon, TruckIcon } from "@/components/icons";
import { getDb } from "@/lib/db";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { can } from "@/lib/permissions";
import { getApprovedOrders, isReadyToSend } from "@/lib/review";
import { getLatestRun } from "@/lib/run-engine";
import { requirePage } from "@/lib/session";
import { getThresholds } from "@/lib/settings";
import { SendToZohoForm } from "@/components/zoho-forms";
import { zohoOrderingEnabled } from "@/lib/zoho/inventory";
import { getDraftPlan, type DraftGroup } from "@/lib/zoho/ordering";

export const dynamic = "force-dynamic";

export default async function ApprovedPage() {
  const user = await requirePage("viewApproved");
  const canConfirm = can(user.role, "confirmLargeQty");
  const canExport = can(user.role, "exportOrders");
  const db = await getDb();
  const run = await getLatestRun(db);
  const orders = run ? await getApprovedOrders(db, run.id) : [];
  const { maxQtyMultiple } = await getThresholds(db);

  const ready = orders.filter(isReadyToSend);
  const waiting = orders.filter((o) => !isReadyToSend(o));
  const readyUnits = ready.reduce((a, o) => a + (o.finalQuantity ?? 0), 0);

  // Zoho drafts: shown only when the feature flag is on; only procurement can send.
  const zohoOn = zohoOrderingEnabled();
  const canSend = zohoOn && can(user.role, "sendToZoho");
  const drafts: DraftGroup[] = zohoOn && run ? await getDraftPlan(db, run.id) : [];
  const readyGroups = drafts.filter((g) => g.state === "ready");

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
            Approved reorders for procurement. A quantity above {maxQtyMultiple}× the standard reorder quantity needs a
            procurement confirmation before it&apos;s ready to send.{" "}
            {zohoOn
              ? "Procurement can send ready lines to Zoho as draft purchase orders, or download the CSV."
              : "Nothing goes to Zoho from here; download the CSV instead."}
          </p>
        </div>
        {canExport && ready.length > 0 && (
          <a className="button" href="/approved/export">
            <DownloadIcon size={16} /> Download CSV ({ready.length} ready)
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
            Approved recommendations from the <Link href="/review">Review</Link> page appear here, grouped by
            distributor.
          </p>
        </div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <span className="kpi-label">Ready to send</span>
              <span className="kpi-value">{ready.length}</span>
              <span className="kpi-note">{fmtInt(readyUnits)} units</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Waiting for confirmation</span>
              <span className="kpi-value">{waiting.length}</span>
              <span className="kpi-note">{canConfirm ? "confirm them below" : "procurement confirms these"}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Distributors</span>
              <span className="kpi-value">{groups.size}</span>
            </div>
          </div>

          {zohoOn && run && drafts.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Zoho drafts</h2>
                  <div className="muted small">
                    One draft purchase order per distributor for this run, with reference FR-R{run.id}-…. Drafts are
                    never issued from here: review and issue them in Zoho.
                  </div>
                </div>
                {canSend && readyGroups.length > 0 && (
                  <SendToZohoForm
                    runId={run.id}
                    label={`Send to Zoho as draft (${readyGroups.length} distributor${readyGroups.length > 1 ? "s" : ""})`}
                  />
                )}
              </div>
              <ul className="zoho-list">
                {drafts.map((g) => (
                  <li key={g.distributorId}>
                    <div>
                      <strong>{groups.get(g.distributorId)?.[0]?.distributorName ?? g.distributorId}</strong>
                      <span className="product-meta"> · {g.reference}</span>
                      <div className="small">
                        <ZohoState g={g} />
                      </div>
                    </div>
                    {canSend && (g.state === "failed" || g.state === "unknown") && (
                      <SendToZohoForm
                        runId={run.id}
                        distributorId={g.distributorId}
                        label="Retry"
                        needsCheck={g.state === "unknown"}
                        secondary
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {[...groups.values()].map((list) => {
            const first = list[0];
            const subtotal = list.filter(isReadyToSend).reduce((a, o) => a + (o.finalQuantity ?? 0), 0);
            const held = list.filter((o) => !isReadyToSend(o)).length;
            return (
              <div key={first.distributorId ?? "unknown"} className="card">
                <div className="group-head">
                  <div>
                    <h2>{first.distributorName ?? first.distributorId ?? "Unknown distributor"}</h2>
                    <div className="muted small">{first.region}</div>
                  </div>
                  <span className="row">
                    {held > 0 && <span className="badge no-dot tone-overstock">{held} waiting</span>}
                    <span className="badge no-dot tone-ok">{fmtInt(subtotal)} units ready</span>
                  </span>
                </div>
                <div className="table-wrap">
                  <table className="table stack-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="num">Recommended</th>
                        <th className="num">Final qty</th>
                        <th>Status</th>
                        <th>Approved by</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((o) => {
                        const isReady = isReadyToSend(o);
                        return (
                          <tr key={o.recommendationId}>
                            <td data-label="Product">
                              <Link href={`/sku/${o.skuId}`} className="product-name">
                                {o.skuName ?? o.skuId}
                              </Link>
                              <div className="product-meta">
                                {o.skuId} · standard {fmtInt(o.standardReorderQty)}
                              </div>
                            </td>
                            <td data-label="Recommended" className="num">{fmtInt(o.recommendedQuantity)}</td>
                            <td data-label="Final qty" className="num">
                              <strong>{fmtInt(o.finalQuantity)}</strong>{" "}
                              <span className="muted small">{o.unitOfMeasure}</span>
                            </td>
                            <td data-label="Status">
                              <StatusBadge status={o.status} />
                              {zohoOn && o.zohoPurchaseorderNumber && (
                                <span className="hold-note" style={{ color: "var(--high-fg)" }}>
                                  Zoho draft {o.zohoPurchaseorderNumber}
                                </span>
                              )}
                              {o.needsConfirmation &&
                                (isReady ? (
                                  <span className="hold-note" style={{ color: "var(--ok-fg)" }}>
                                    ✓ Confirmed by {o.confirmedBy} · {fmtDateTime(o.confirmedAt)}
                                  </span>
                                ) : (
                                  <>
                                    <span className="hold-note">
                                      Above {maxQtyMultiple}× standard: needs procurement confirmation
                                    </span>
                                    {canConfirm && <ConfirmQuantityForm recommendationId={o.recommendationId} />}
                                  </>
                                ))}
                            </td>
                            <td data-label="Approved by">
                              {o.reviewedBy}
                              <div className="product-meta">{fmtDateTime(o.reviewedAt)}</div>
                            </td>
                            <td data-label="Note" className="muted">{o.reviewNote}</td>
                          </tr>
                        );
                      })}
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

function ZohoState({ g }: { g: DraftGroup }) {
  const units = g.lines.reduce((a, l) => a + l.quantity, 0);
  switch (g.state) {
    case "sent":
      return (
        <span style={{ color: "var(--ok-fg)" }}>
          ✓ Draft {g.send?.poNumber} created in Zoho ({g.lines.length} line{g.lines.length === 1 ? "" : "s"})
          {g.lateLines.length > 0 && (
            <span style={{ color: "var(--overstock-fg)" }}>
              {" "}
              · {g.lateLines.length} line(s) approved later are not on it: add {g.lateLines.map((l) => l.skuId).join(", ")} in
              Zoho by hand
            </span>
          )}
        </span>
      );
    case "ready":
      return (
        <span className="muted">
          Ready: {g.lines.length} line{g.lines.length === 1 ? "" : "s"}, {units} units
        </span>
      );
    case "unmapped":
      return (
        <span style={{ color: "var(--overstock-fg)" }}>
          Can&apos;t send yet: {!g.vendorId ? "no Zoho vendor" : ""}
          {!g.vendorId && g.missingItems.length ? "; " : ""}
          {g.missingItems.length ? `no Zoho item for ${g.missingItems.join(", ")}` : ""}. Fix on the Zoho mapping page.
        </span>
      );
    case "failed":
      return <span style={{ color: "var(--stockout-fg)" }}>Failed (nothing created): {g.send?.error}</span>;
    case "unknown":
      return (
        <span style={{ color: "var(--stockout-fg)" }}>
          No answer from Zoho: {g.send?.error} Check Zoho for {g.reference} before retrying.
        </span>
      );
    case "sending":
      return <span className="muted">Sending…</span>;
    default:
      return null;
  }
}
