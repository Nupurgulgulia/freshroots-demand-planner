import Link from "next/link";
import { ActionText, FlagBadge } from "@/components/badges";
import { getDb } from "@/lib/db";
import { fmt1, fmtDateTime, fmtInt } from "@/lib/format";
import { can } from "@/lib/permissions";
import { getRunComparison, getRunHistory, type ChangeKind, type RunSummary } from "@/lib/run-history";
import { requirePage } from "@/lib/session";

export const dynamic = "force-dynamic";

const CHANGE_LABELS: Record<ChangeKind, string> = {
  new: "New SKU",
  dropped: "Not in newer run",
  flag: "Flag or action changed",
  quantity: "Quantity changed",
  exception: "Exception changed",
};

const delta = (a: number, b: number) => {
  const d = b - a;
  return d === 0 ? "" : ` (${d > 0 ? "+" : ""}${d.toLocaleString("en-IN")})`;
};

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const user = await requirePage("viewRuns");
  const canOpenSku = can(user.role, "viewSku");
  const db = await getDb();
  const history = await getRunHistory(db);
  const params = await searchParams;

  // Default comparison: the latest run against the one before it.
  const a = Number(params.a) || history[1]?.run.id;
  const b = Number(params.b) || history[0]?.run.id;
  const comparison = a && b && a !== b ? await getRunComparison(db, a, b) : null;
  const badPick = params.a !== undefined && params.b !== undefined && !comparison;

  const rows: { label: string; pick: (s: RunSummary) => number }[] = [
    { label: "Exceptions", pick: (s) => s.flags.EXCEPTION },
    { label: "Stockout risk", pick: (s) => s.flags.STOCKOUT },
    { label: "Overstock risk", pick: (s) => s.flags.OVERSTOCK },
    { label: "High demand", pick: (s) => s.flags.HIGH_DEMAND },
    { label: "No action", pick: (s) => s.flags.NO_ACTION },
    { label: "Units recommended", pick: (s) => s.recommendedUnits },
    { label: "Units approved", pick: (s) => s.approvedUnits },
    { label: "Still pending", pick: (s) => s.pending },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Every recalculation is kept</div>
          <h1>Run history</h1>
          <p className="muted">
            Past runs with what each one recommended and how it was decided. Pick two runs to see what changed between
            them.
          </p>
        </div>
      </div>

      {history.length === 0 ? (
        <div className="card empty">
          <p>No runs yet. Upload data and recalculate to create the first one.</p>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Compare two runs</h2>
                <div className="muted small">The older run is always shown first.</div>
              </div>
            </div>
            <form method="get" className="inline-form compare-form">
              <label className="compare-pick">
                <span className="small muted">Run A</span>
                <select name="a" defaultValue={String(comparison?.runA.id ?? a ?? "")}>
                  {history.map(({ run }) => (
                    <option key={run.id} value={run.id}>
                      #{run.id} · {run.nowWeek} · {fmtDateTime(run.createdAt)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="compare-pick">
                <span className="small muted">Run B</span>
                <select name="b" defaultValue={String(comparison?.runB.id ?? b ?? "")}>
                  {history.map(({ run }) => (
                    <option key={run.id} value={run.id}>
                      #{run.id} · {run.nowWeek} · {fmtDateTime(run.createdAt)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="button">
                Compare
              </button>
            </form>
            {history.length < 2 && <p className="muted small">Only one run so far: recalculate again to compare.</p>}
            {badPick && (
              <div className="status status-warning" role="status" style={{ marginTop: 12 }}>
                Pick two different runs to compare.
              </div>
            )}
          </div>

          {comparison && (
            <div className="card" data-testid="comparison">
              <div className="card-head">
                <div>
                  <h2>
                    Run #{comparison.runA.id} ({comparison.runA.nowWeek}) → Run #{comparison.runB.id} (
                    {comparison.runB.nowWeek})
                  </h2>
                  <div className="muted small">
                    {comparison.changes.length === 0
                      ? `No recommendation changed across ${comparison.unchanged} SKUs.`
                      : `${comparison.changes.length} SKU${comparison.changes.length === 1 ? "" : "s"} changed, ${comparison.unchanged} unchanged.`}
                  </div>
                </div>
              </div>

              <div className="grid-2">
                <div>
                  <h3>Totals</h3>
                  <dl className="kv">
                    {rows.map((r) => (
                      <div key={r.label} style={{ display: "contents" }}>
                        <dt>{r.label}</dt>
                        <dd>
                          {fmtInt(r.pick(comparison.summaryA))} → {fmtInt(r.pick(comparison.summaryB))}
                          <span className="muted">{delta(r.pick(comparison.summaryA), r.pick(comparison.summaryB))}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div>
                  <h3>Thresholds</h3>
                  {comparison.thresholdChanges.length === 0 ? (
                    <p className="muted">Same thresholds in both runs, so changes come from the data.</p>
                  ) : (
                    <dl className="kv">
                      {comparison.thresholdChanges.map((t) => (
                        <div key={t.label} style={{ display: "contents" }}>
                          <dt>{t.label}</dt>
                          <dd>
                            {t.a}
                            {t.unit} → {t.b}
                            {t.unit}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </div>

              {comparison.changes.length > 0 && (
                <div className="table-wrap" style={{ marginTop: 16 }}>
                  <table className="table stack-table">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>What changed</th>
                        <th>Run #{comparison.runA.id}</th>
                        <th>Run #{comparison.runB.id}</th>
                        <th className="num">Cover (wks)</th>
                        <th className="num">Weekly demand</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.changes.map((c) => (
                        <tr key={c.skuId}>
                          <td data-label="SKU">
                            {canOpenSku ? (
                              <Link href={`/sku/${c.skuId}`} className="product-name">
                                {c.name ?? c.skuId}
                              </Link>
                            ) : (
                              <span className="product-name">{c.name ?? c.skuId}</span>
                            )}
                            <div className="product-meta">{c.skuId}</div>
                          </td>
                          <td data-label="What changed">{c.kinds.map((k) => CHANGE_LABELS[k]).join(", ")}</td>
                          <td data-label={`Run #${comparison.runA.id}`}>
                            {c.a ? (
                              <>
                                <FlagBadge flag={c.a.flag} /> <ActionText action={c.a.action} quantity={c.a.quantity} />
                              </>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td data-label={`Run #${comparison.runB.id}`}>
                            {c.b ? (
                              <>
                                <FlagBadge flag={c.b.flag} /> <ActionText action={c.b.action} quantity={c.b.quantity} />
                              </>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td data-label="Cover (wks)" className="num">
                            {fmt1(c.a?.weeksOfCover)} → {fmt1(c.b?.weeksOfCover)}
                          </td>
                          <td data-label="Weekly demand" className="num">
                            {fmt1(c.a?.demandBaseline)} → {fmt1(c.b?.demandBaseline)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <div>
                <h2>All runs</h2>
                <div className="muted small">Newest first, last {history.length} shown.</div>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table stack-table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Created</th>
                    <th>Flags</th>
                    <th className="num">Decided</th>
                    <th className="num">Units rec. / approved</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(({ run, summary: s }, i) => {
                    const previous = history[i + 1]?.run;
                    return (
                      <tr key={run.id}>
                        <td data-label="Run" style={{ fontWeight: 600 }}>
                          #{run.id} · {run.nowWeek}
                        </td>
                        <td data-label="Created">
                          {fmtDateTime(run.createdAt)}
                          <div className="product-meta">by {run.triggeredBy}</div>
                        </td>
                        <td data-label="Flags">
                          {s.flags.EXCEPTION} exception · {s.flags.STOCKOUT} stockout · {s.flags.OVERSTOCK} overstock
                          {s.flags.HIGH_DEMAND ? ` · ${s.flags.HIGH_DEMAND} high demand` : ""}
                        </td>
                        <td data-label="Decided" className="num">
                          {s.decided} of {s.actionable}
                          {s.pending > 0 && <div className="product-meta">{s.pending} pending</div>}
                        </td>
                        <td data-label="Units rec. / approved" className="num">
                          {fmtInt(s.recommendedUnits)} / {fmtInt(s.approvedUnits)}
                        </td>
                        <td data-label="">
                          {previous && (
                            <Link href={`/runs?a=${previous.id}&b=${run.id}`} className="small">
                              Compare with #{previous.id}
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
