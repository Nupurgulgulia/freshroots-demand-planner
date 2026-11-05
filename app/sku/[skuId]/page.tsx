import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { FlagBadge, StatusBadge, actionText } from "@/components/badges";
import { RegenerateForm, ReviewForm } from "@/components/forms";
import { SalesChart } from "@/components/SalesChart";
import { geminiConfigured } from "@/lib/ai/gemini";
import { getDb, schema } from "@/lib/db";
import { fmt1, fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import { getAuditForSku } from "@/lib/review";
import { getLatestRun } from "@/lib/run-engine";
import { RULE_LABELS, type Evaluation, type RuleId, type Thresholds } from "@/lib/rules/engine";
import { weeksEndingAt } from "@/lib/rules/weeks";

export const dynamic = "force-dynamic";

const CHART_WEEKS = 16;

export default async function SkuPage({ params }: { params: Promise<{ skuId: string }> }) {
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
      <p>
        <Link href="/">← Dashboard</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>
            {skuId} · {sku?.name ?? "Unknown SKU"}
          </h1>
          <div className="muted">
            {sku?.category} · {e.perishability ?? "?"} perishability · standard reorder {fmtInt(sku?.standardReorderQty)}{" "}
            {sku?.unitOfMeasure} · {dist ? `${dist.name} (${dist.region}, ${dist.status})` : "distributor unknown"}
          </div>
        </div>
        <div className="row">
          <FlagBadge flag={rec.flag} />
          <strong>{actionText(rec.action, rec.quantity)}</strong>
          <StatusBadge status={rec.status} />
        </div>
      </div>

      <div className="card">
        <h2>Sales, last {CHART_WEEKS} weeks</h2>
        <SalesChart data={chartData} avg12={e.avg12} baseline={e.festivalMonth ? e.demandBaseline : null} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Numbers behind the decision</h2>
          <dl className="kv">
            <dt>Now (latest sales week)</dt>
            <dd>{run.nowWeek}</dd>
            <dt>Units on hand</dt>
            <dd>
              {fmtInt(e.unitsOnHand)} {e.asOfDate && <span className="muted">as of {e.asOfDate}</span>}
            </dd>
            <dt>12-week average</dt>
            <dd>{fmt1(e.avg12)} units/week</dd>
            <dt>4-week average</dt>
            <dd>
              {fmt1(e.avg4)} units/week{" "}
              <span className="muted">({fmtPct(e.demandRatio == null ? null : e.demandRatio - 1)} vs 12-week)</span>
            </dd>
            <dt>Festival month</dt>
            <dd>{e.festivalMonth ? `Yes (+${Math.round(t.festivalUpliftPct * 100)}%)` : "No"}</dd>
            <dt>Demand baseline</dt>
            <dd>{fmt1(e.demandBaseline)} units/week</dd>
            <dt>Weeks of cover</dt>
            <dd>{fmt1(e.weeksOfCover)}</dd>
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
          </dl>
        </div>

        <div className="card">
          <h2>Rules</h2>
          <ul className="rules">
            {checks.map((c) => (
              <li key={c.rule}>
                <span className={c.fired ? "fired" : "not-fired"}>{c.fired ? "✔ fired" : "✘ not fired"}</span> —{" "}
                <strong>{RULE_LABELS[c.rule]}</strong>: {c.text}
              </li>
            ))}
            {otherFired.map((r) => (
              <li key={r}>
                <span className="fired">✔ fired</span> — <strong>{RULE_LABELS[r]}</strong>
              </li>
            ))}
          </ul>
          {e.exceptionReasons.length > 0 && (
            <>
              <h2>Why this is an exception</h2>
              <ul>
                {e.exceptionReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
          <p>
            <strong>Engine reason:</strong> {rec.reason}
          </p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card stack">
          <h2>Gemini explanation</h2>
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
              <div className="muted">
                {ai.model} · {fmtDateTime(ai.createdAt)} · wording only; numbers and action come from the engine
              </div>
            </div>
          ) : (
            <p className="muted">Not generated yet.</p>
          )}
          {ai?.error && <div className="status status-error">Last attempt failed: {ai.error}</div>}
          {rec.action !== "NONE" && <RegenerateForm recommendationId={rec.id} enabled={geminiConfigured()} />}
        </div>

        <div className="card stack">
          <h2>Review</h2>
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
              <ReviewForm recommendationId={rec.id} quantity={rec.quantity} action={rec.action} />
            </>
          )}
        </div>
      </div>

      <div className="card">
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
          <p className="muted">
            Recent runs:{" "}
            {otherRuns.map((o) => `#${o.runId} ${actionText(o.action, o.quantity)}`).join(" · ")}
          </p>
        )}
      </div>
    </>
  );
}
