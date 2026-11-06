import { FiguresForm } from "@/components/forms";
import { ClockIcon, EditIcon, TrendUpIcon, BoxIcon } from "@/components/icons";
import {
  AccuracyTrendChart,
  LossesChart,
  ReviewTrendChart,
  StockHistoryChart,
  type TrendPoint,
} from "@/components/PerformanceCharts";
import { getDb } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { OUTCOME_WEEKS, quarterOf } from "@/lib/performance";
import { getPerformanceData } from "@/lib/performance-data";
import { can } from "@/lib/permissions";
import { weeksAfter } from "@/lib/rules/weeks";
import { requirePage } from "@/lib/session";

export const dynamic = "force-dynamic";

const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 1000) / 10}%`);
const inr = (x: number | null | undefined) =>
  x == null ? "—" : x.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const duration = (hours: number | null) =>
  hours == null
    ? "—"
    : hours < 1
      ? `${Math.max(1, Math.round(hours * 60))} min`
      : hours < 48
        ? `${Math.round(hours * 10) / 10} h`
        : `${Math.round((hours / 24) * 10) / 10} days`;

export default async function PerformancePage() {
  const user = await requirePage("viewPerformance");
  const canEnter = can(user.role, "enterFigures");
  const db = await getDb();
  const d = await getPerformanceData(db);
  const s = d.summary;

  const trend: TrendPoint[] = d.trend.map((t) => ({
    label: `#${t.runId} ${t.week.slice(5)}`,
    accuracy: t.accuracy,
    overrideRate: t.overrideRate,
    turnaroundHours: t.turnaroundHours == null ? null : Math.round(t.turnaroundHours * 10) / 10,
  }));
  const latestWeek = d.latestRun?.nowWeek;
  const measurableFrom = latestWeek ? weeksAfter(latestWeek, OUTCOME_WEEKS).at(-1) : null;

  const kpis = [
    {
      label: "Forecast accuracy",
      value: pct(s.accuracy),
      note: s.accuracy == null ? "not measurable yet" : `volume-weighted, ${s.accuracySkus} SKU forecasts`,
      tone: "tone-accent",
      Icon: TrendUpIcon,
    },
    {
      label: "Cover healthy now",
      value: s.healthyCover ? pct(s.healthyCover.share) : "—",
      note: s.healthyCover ? `${s.healthyCover.healthy} of ${s.healthyCover.measured} decided SKUs` : "no decided SKUs yet",
      tone: "tone-ok",
      Icon: BoxIcon,
    },
    {
      label: "Override rate",
      value: s.override ? pct(s.override.rate) : "—",
      note: s.override ? `${s.override.overridden} of ${s.override.decided} decisions edited or rejected` : "no decisions yet",
      tone: "tone-overstock",
      Icon: EditIcon,
    },
    {
      label: "Median review time",
      value: duration(s.turnaroundHours),
      note: "run created → first decision",
      tone: "tone-neutral",
      Icon: ClockIcon,
    },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Outcomes {OUTCOME_WEEKS} complete weeks after each run</div>
          <h1>Performance</h1>
          <p className="muted">
            How recommendations and decisions turned out. Latest sales week: {d.latestSalesWeek ?? "none"}.{" "}
            {s.measurableRuns} {s.measurableRuns === 1 ? "week is" : "weeks are"} old enough to measure.
          </p>
        </div>
      </div>

      {s.measurableRuns === 0 && (
        <div className="status status-warning" role="status" style={{ marginBottom: 20 }}>
          Too early to measure outcomes: the latest run is for {latestWeek ?? "—"}, so its results can be checked once
          sales data runs to {measurableFrom ?? "—"}. Override rate and review time per run are shown below already.
        </div>
      )}

      <div className="kpis">
        {kpis.map(({ label, value, note, tone, Icon }) => (
          <div key={label} className="kpi">
            <span className="kpi-label">
              <span className={`kpi-icon ${tone}`}>
                <Icon size={16} />
              </span>
              {label}
            </span>
            <span className="kpi-value">{value}</span>
            <span className="kpi-note">{note}</span>
          </div>
        ))}
      </div>

      <div className="chart-grid">
        <div className="card chart-card span-half">
          <div className="card-head">
            <div>
              <h2>Forecast accuracy by run</h2>
              <div className="muted small">
                Demand baseline vs actual average weekly sales over the next {OUTCOME_WEEKS} weeks (1 − WAPE)
              </div>
            </div>
          </div>
          {trend.some((t) => t.accuracy != null) ? (
            <AccuracyTrendChart data={trend} />
          ) : (
            <p className="muted">No run has {OUTCOME_WEEKS} weeks of sales after it yet.</p>
          )}
        </div>
        <div className="card chart-card span-half">
          <div className="card-head">
            <div>
              <h2>Overrides and review time by run</h2>
              <div className="muted small">Share of decisions edited or rejected, and median hours to first decision</div>
            </div>
          </div>
          {trend.some((t) => t.overrideRate != null) ? (
            <ReviewTrendChart data={trend} />
          ) : (
            <p className="muted">No decisions recorded yet.</p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Quarterly losses: baseline vs target</h2>
            <div className="muted small">
              Typed in by hand from finance records. The app doesn&apos;t measure these and shows no savings of its own.
            </div>
          </div>
          <span className="badge no-dot tone-overstock">Entered, not measured</span>
        </div>
        {d.figures.length > 0 ? (
          <>
            <LossesChart
              data={d.figures.map((f) => ({
                quarter: f.quarter,
                baseline: f.baselineLoss,
                target: f.targetLoss,
                actual: f.actualLoss,
              }))}
            />
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="table stack-table">
                <thead>
                  <tr>
                    <th>Quarter</th>
                    <th className="num">Baseline (entered)</th>
                    <th className="num">Target (entered)</th>
                    <th className="num">Actual (entered)</th>
                    <th>Entered by</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {d.figures.map((f) => (
                    <tr key={f.quarter}>
                      <td data-label="Quarter" style={{ fontWeight: 600 }}>
                        {f.quarter}
                      </td>
                      <td data-label="Baseline (entered)" className="num">
                        {inr(f.baselineLoss)}
                      </td>
                      <td data-label="Target (entered)" className="num">
                        {inr(f.targetLoss)}
                      </td>
                      <td data-label="Actual (entered)" className="num">
                        {inr(f.actualLoss)}
                      </td>
                      <td data-label="Entered by">
                        {f.enteredBy}
                        <div className="product-meta">{fmtDateTime(f.enteredAt)}</div>
                      </td>
                      <td data-label="Note" className="muted">
                        {f.note}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="muted">No figures entered yet.</p>
        )}
        {canEnter && (
          <div style={{ marginTop: 16 }}>
            <h3>Enter or update a quarter</h3>
            <FiguresForm defaultQuarter={quarterOf(new Date())} />
          </div>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Rupee exposure (latest run)</h2>
              <div className="muted small">Calculated as units × Unit_Price from the SKU master. Not a saving.</div>
            </div>
          </div>
          {d.exposure ? (
            <>
              <dl className="kv">
                <dt>Stock on hand</dt>
                <dd>{inr(d.exposure.stock)}</dd>
                <dt>Above the overstock limit</dt>
                <dd>{inr(d.exposure.aboveOverstock)}</dd>
                <dt>Approved orders ready to send</dt>
                <dd>{inr(d.exposure.orders)}</dd>
              </dl>
              {d.exposure.pricedSkus < d.exposure.totalSkus && (
                <p className="muted small" style={{ marginBottom: 0 }}>
                  Only {d.exposure.pricedSkus} of {d.exposure.totalSkus} SKUs have a price; the rest are left out.
                </p>
              )}
            </>
          ) : (
            <p className="muted">
              No prices loaded. Add a <code>Unit_Price</code> column (₹ per unit) to sku_master.csv and upload it to see
              rupee values here.
            </p>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Stock on hand over time</h2>
              <div className="muted small">Total units at each stock upload (every upload is kept as a snapshot)</div>
            </div>
          </div>
          {d.stockHistory.length > 0 ? (
            <StockHistoryChart
              data={d.stockHistory.map((h) => ({
                label: new Date(h.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }),
                units: h.units,
              }))}
            />
          ) : (
            <p className="muted">Snapshots start with the next current_inventory upload.</p>
          )}
        </div>
      </div>
    </>
  );
}
