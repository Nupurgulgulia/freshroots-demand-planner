import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { CoverBar, FlagBadge, StatusBadge, actionText } from "@/components/badges";
import { RegenerateForm, ReviewForm } from "@/components/forms";
import { ArrowLeftIcon, CheckIcon, SparkIcon, XIcon } from "@/components/icons";
import { SalesChart } from "@/components/SalesChart";
import { geminiConfigured } from "@/lib/ai/gemini";
import { getDb, schema } from "@/lib/db";
import { fmt1, fmtCover, fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import { getAuditForSku } from "@/lib/review";
import { can } from "@/lib/permissions";
import { getLatestRun } from "@/lib/run-engine";
import { requirePage } from "@/lib/session";
import { RULE_LABELS, type Evaluation, type RuleId, type Thresholds } from "@/lib/rules/engine";
import { isOpenPoStatus } from "@/lib/rules/inputs";
import { weeksEndingAt } from "@/lib/rules/weeks";

export const dynamic = "force-dynamic";

const CHART_WEEKS = 16;

export default async function SkuPage({ params }: { params: Promise<{ skuId: string }> }) {
  const user = await requirePage("viewSku");
  const canDecide = can(user.role, "review");
  const canAi = can(user.role, "generateAi");
  const { skuId } = await params;
  const db = await getDb();
  const run = await getLatestRun(db);
  if (!run) notFound();

  const [row] = await db
    .select({ rec: schema.recommendations, sku: schema.skus, ai: schema.aiExplanations, dist: schema.distributors })
    .from(schema.recommendations)
    .leftJoin(schema.skus, eq(schema.skus.skuId, schema.recommendations.skuId))
    .leftJoin(schema.distributors, eq(schema.distributors.distributorId, schema.skus.distributorId))
    .leftJoin(schema.aiExplanations, eq(schema.aiExplanations.recommendationId, schema.recommendations.id))
    .where(and(eq(schema.recommendations.runId, run.id), eq(schema.recommendations.skuId, skuId)));
  if (!row) notFound();

  const { rec, sku, ai, dist } = row;
  const e = rec.evaluation as Evaluation;
  const t = run.thresholds as Thresholds;

  const chartWeeks = weeksEndingAt(run.nowWeek, CHART_WEEKS);
  const sales = await db
    .select()
    .from(schema.weeklySales)
    .where(and(eq(schema.weeklySales.skuId, skuId), inArray(schema.weeklySales.week, chartWeeks)));
  const byWeek = new Map(sales.map((s) => [s.week, s.unitsSold]));
  const last12 = new Set(chartWeeks.slice(-12));
  const chartData = chartWeeks.map((week) => ({ week, units: byWeek.get(week) ?? null, inLast12: last12.has(week) }));

  const audit = await getAuditForSku(db, skuId);
  // Current open-PO snapshot for this SKU (the run itself stores only the total it used).
  const poLines = (
    await db.select().from(schema.openPurchaseOrders).where(eq(schema.openPurchaseOrders.skuId, skuId))
  ).filter((p) => isOpenPoStatus(p.status));
  const onOrder = e.unitsOnOrder ?? 0;
  const otherRuns = await db
    .select({ runId: schema.recommendations.runId, flag: schema.recommendations.flag, action: schema.recommendations.action, quantity: schema.recommendations.quantity })
    .from(schema.recommendations)
    .where(eq(schema.recommendations.skuId, skuId))
    .orderBy(desc(schema.recommendations.runId))
    .limit(6);

  const fired = new Set(e.rulesFired);
  const dataOk = e.action !== "REVIEW";
  const checks: { rule: RuleId; text: string; fired: boolean }[] = [
    {
      rule: "FESTIVAL_UPLIFT",
      fired: fired.has("FESTIVAL_UPLIFT"),
      text: e.asOfDate
        ? `${e.asOfDate.slice(0, 7)} is ${e.festivalMonth ? "" : "not "}a festival month → baseline = ${fmt1(e.avg12)}${e.festivalMonth ? ` × ${1 + t.festivalUpliftPct} = ${fmt1(e.demandBaseline)}` : ""}`
        : "No stock date, so the festival month is unknown",
    },
    {
      rule: "STOCKOUT_RISK",
      fired: fired.has("STOCKOUT_RISK"),
      text: dataOk ? `Cover ${fmt1(e.weeksOfCover)} < ${e.stockoutThresholdWeeks} weeks?` : "Not evaluated (data problem)",
    },
    {
      rule: "OVERSTOCK_RISK",
      fired: fired.has("OVERSTOCK_RISK"),
      text: dataOk ? `Cover ${fmt1(e.weeksOfCover)} > ${e.overstockThresholdWeeks} weeks?` : "Not evaluated (data problem)",
    },
    {
      rule: "HIGH_DEMAND",
      fired: fired.has("HIGH_DEMAND"),
      text: dataOk
        ? `4-week avg ${fmt1(e.avg4)} > ${1 + t.highDemandPct} × 12-week avg ${fmt1(e.avg12)} = ${fmt1((1 + t.highDemandPct) * (e.avg12 ?? 0))}?`
        : "Not evaluated (data problem)",
    },
  ];
  const otherFired = e.rulesFired.filter((r) => !checks.some((c) => c.rule === r));

  return (
    <>
      <Link href="/" className="back-link">
        <ArrowLeftIcon size={16} /> Dashboard
      </Link>

      <div className="card">
        <div className="hero">
          <div>
            <div className="eyebrow">{skuId}</div>
            <h1>{sku?.name ?? "Unknown SKU"}</h1>
            <div className="meta">
              {sku?.category && <span className="tag">{sku.category}</span>}
              <span className={`tag ${e.perishability === "High" ? "perishable" : ""}`}>
                {e.perishability ?? "?"} perishability
              </span>
              <span className="tag">
                Standard reorder {fmtInt(sku?.standardReorderQty)} {sku?.unitOfMeasure}
              </span>
              <span className="tag">
                {dist ? `${dist.name} · ${dist.region} · ${dist.status}` : "Distributor unknown"}
              </span>
            </div>
          </div>
          <div className="decision-panel">
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <FlagBadge flag={rec.flag} />
              <StatusBadge status={rec.status} />
            </div>
            <div className="big">{actionText(rec.action, rec.quantity)}</div>
            <div className="muted small">Engine recommendation for week {run.nowWeek}</div>
          </div>
        </div>
      </div>

      <div className="stat-tiles">
        <div className="stat">
          <div className="stat-label">Units on hand</div>
          <div className="stat-value">{fmtInt(e.unitsOnHand)}</div>
          <div className="stat-note">{e.asOfDate ? `as of ${e.asOfDate}` : "no stock date"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">On order</div>
          <div className="stat-value">{fmtInt(onOrder)}</div>
          <div className="stat-note">
            {onOrder > 0 ? `counted in cover · ${fmtInt(e.stockPosition)} total` : "no open purchase orders"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">12-week average</div>
          <div className="stat-value">{fmt1(e.avg12)}</div>
          <div className="stat-note">units / week</div>
        </div>
        <div className="stat">
          <div className="stat-label">4-week average</div>
          <div className="stat-value">{fmt1(e.avg4)}</div>
          <div className="stat-note">{fmtPct(e.demandRatio == null ? null : e.demandRatio - 1)} vs 12-week</div>
        </div>
        <div className="stat">
          <div className="stat-label">Demand baseline</div>
          <div className="stat-value">{fmt1(e.demandBaseline)}</div>
          <div className="stat-note">
            {e.festivalMonth ? `festival month, +${Math.round(t.festivalUpliftPct * 100)}%` : "not a festival month"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Weeks of cover</div>
          <div className="stat-value">{fmtCover(e.weeksOfCover, [e.stockoutThresholdWeeks, e.overstockThresholdWeeks])}</div>
          <div className="stat-note" style={{ marginTop: 4 }}>
            <CoverBar weeks={e.weeksOfCover} stockout={e.stockoutThresholdWeeks} overstock={e.overstockThresholdWeeks} barOnly />
          </div>
        </div>
      </div>

      {poLines.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Open purchase orders</h2>
            <span className="muted small">
              Loaded {fmtDateTime(poLines[0].loadedAt)} from {poLines[0].source === "zoho" ? "Zoho Inventory" : "CSV"}
            </span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Status</th>
                  <th>Expected</th>
                  <th className="num">Ordered</th>
                  <th className="num">Received</th>
                  <th className="num">Still to come</th>
                </tr>
              </thead>
              <tbody>
                {poLines.map((p) => (
                  <tr key={p.poNumber}>
                    <td style={{ fontWeight: 500 }}>{p.poNumber}</td>
                    <td>
                      <span className="badge no-dot tone-neutral">{p.status}</span>
                    </td>
                    <td className="muted">{p.expectedDate ?? "—"}</td>
                    <td className="num">{fmtInt(p.orderedQty)}</td>
                    <td className="num">{fmtInt(p.receivedQty)}</td>
                    <td className="num">
                      <strong>{fmtInt(Math.max(0, p.orderedQty - p.receivedQty))}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Sales, last {CHART_WEEKS} weeks</h2>
          <span className="muted small">Darker bars are the 12-week window used by the rules</span>
        </div>
        <SalesChart data={chartData} avg12={e.avg12} baseline={e.festivalMonth ? e.demandBaseline : null} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>How the engine decided</h2>
          <ul className="rules">
            {checks.map((c) => (
              <li key={c.rule}>
                <span className={`mark ${c.fired ? "on" : "off"}`}>
                  {c.fired ? <CheckIcon size={13} /> : <XIcon size={12} />}
                </span>
                <span>
                  <span className="rule-name">{RULE_LABELS[c.rule]}</span>
                  <span className="muted small">{c.fired ? " · applies" : " · does not apply"}</span>
                  <div className="rule-text">{c.text}</div>
                </span>
              </li>
            ))}
            {otherFired.map((r) => (
              <li key={r}>
                <span className="mark on">
                  <CheckIcon size={13} />
                </span>
                <span className="rule-name">{RULE_LABELS[r]}</span>
              </li>
            ))}
          </ul>
          {e.exceptionReasons.length > 0 && (
            <div className="callout" style={{ marginTop: 14 }}>
              <strong>Why this is an exception</strong>
              <ul>
                {e.exceptionReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="muted" style={{ marginBottom: 0 }}>
            <strong style={{ color: "var(--text)" }}>Engine reason:</strong> {rec.reason}
          </p>
        </div>

        <div className="card">
          <h2>Numbers behind the decision</h2>
          <dl className="kv">
            <dt>Now (latest sales week)</dt>
            <dd>{run.nowWeek}</dd>
            <dt>Thresholds used</dt>
            <dd>
              stockout &lt; {e.stockoutThresholdWeeks} wks, overstock &gt; {e.overstockThresholdWeeks} wks, high demand &gt;
              +{Math.round(t.highDemandPct * 100)}%, boost {t.highDemandMultiplier}×
            </dd>
            <dt>Weeks of history</dt>
            <dd>
              {e.weeksOfHistory}
              {e.missingWeeks.length > 0 && <span className="muted"> (missing {e.missingWeeks.join(", ")})</span>}
            </dd>
            <dt>Festival month</dt>
            <dd>{e.festivalMonth ? `Yes (+${Math.round(t.festivalUpliftPct * 100)}%)` : "No"}</dd>
          </dl>
        </div>
      </div>

      <div className="grid-2">
        <div className="card stack">
          <div className="card-head" style={{ marginBottom: 0 }}>
            <h2>
              <span className="ai-tag" style={{ fontSize: 15 }}>
                <SparkIcon size={16} />
              </span>{" "}
              AI explanation
            </h2>
            {rec.action !== "NONE" && canAi && (
              <RegenerateForm recommendationId={rec.id} enabled={geminiConfigured()} />
            )}
          </div>
          {rec.action === "NONE" ? (
            <p className="muted">No action recommended, so no explanation is generated.</p>
          ) : ai?.reason ? (
            <div className="ai-box stack">
              <p>
                <strong>Reason:</strong> {ai.reason}
              </p>
              {ai.brief && (
                <p>
                  <strong>Planner brief:</strong> {ai.brief}
                </p>
              )}
              <div className="muted small">
                {ai.model} · {fmtDateTime(ai.createdAt)} · wording only; numbers and action come from the engine
              </div>
            </div>
          ) : (
            <p className="muted">Not generated yet.</p>
          )}
          {ai?.error && <div className="status status-error">Last attempt failed: {ai.error}</div>}
        </div>

        <div className="card stack">
          <h2>{canDecide ? "Your decision" : "Decision"}</h2>
          {rec.action === "NONE" ? (
            <p className="muted">Nothing to review.</p>
          ) : (
            <>
              {rec.status !== "PENDING" && (
                <p>
                  Current decision: <StatusBadge status={rec.status} /> by {rec.reviewedBy}, final quantity{" "}
                  {fmtInt(rec.finalQuantity)}. You can record a new decision below.
                </p>
              )}
              {canDecide ? (
                <ReviewForm recommendationId={rec.id} quantity={rec.quantity} action={rec.action} />
              ) : (
                rec.status === "PENDING" && <p className="muted">Waiting for a planner's decision.</p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2>Decision history</h2>
        {audit.length === 0 ? (
          <p className="muted">No decisions yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Run</th>
                  <th>Who</th>
                  <th>Decision</th>
                  <th className="num">Original qty</th>
                  <th className="num">Final qty</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td>{fmtDateTime(a.createdAt)}</td>
                    <td>#{a.runId}</td>
                    <td>{a.reviewer}</td>
                    <td>
                      <StatusBadge status={a.decision} />
                    </td>
                    <td className="num">{fmtInt(a.originalQuantity)}</td>
                    <td className="num">{fmtInt(a.finalQuantity)}</td>
                    <td>{a.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {otherRuns.length > 1 && (
          <p className="muted small">
            Recent runs:{" "}
            {otherRuns.map((o) => `#${o.runId} ${actionText(o.action, o.quantity)}`).join(" · ")}
          </p>
        )}
      </div>
    </>
  );
}
