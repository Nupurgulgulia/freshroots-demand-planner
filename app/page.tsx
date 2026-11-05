import Link from "next/link";
import { inArray, sum } from "drizzle-orm";
import { ActionText, CoverBar, FlagBadge, StatusBadge } from "@/components/badges";
import { SalesTrendChart, StatusMixChart, type TrendPoint } from "@/components/DashboardCharts";
import { StockHealth, type HealthRow } from "@/components/StockHealth";
import { GenerateExplanationsForm, RecalculateForm } from "@/components/forms";
import { AlertIcon, BoxIcon, ClockIcon, SparkIcon, TrendUpIcon, TruckIcon, UploadIcon } from "@/components/icons";
import { geminiConfigured } from "@/lib/ai/gemini";
import { getDb, schema, type Db } from "@/lib/db";
import { fmt1, fmtDateTime, fmtInt } from "@/lib/format";
import { getLatestRun, getRunRecommendations } from "@/lib/run-engine";
import { FLAG_LABELS, type Flag, type Thresholds } from "@/lib/rules/engine";
import { isoWeekMonday, weeksEndingAt } from "@/lib/rules/weeks";

export const dynamic = "force-dynamic";

const TREND_WEEKS = 16;

/** Units sold per week across all SKUs, with festival weeks (by the week's Thursday) marked. */
async function getSalesTrend(db: Db, nowWeek: string): Promise<TrendPoint[]> {
  const weeks = weeksEndingAt(nowWeek, TREND_WEEKS);
  const [totals, calendar] = await Promise.all([
    db
      .select({ week: schema.weeklySales.week, units: sum(schema.weeklySales.unitsSold) })
      .from(schema.weeklySales)
      .where(inArray(schema.weeklySales.week, weeks))
      .groupBy(schema.weeklySales.week),
    db.select().from(schema.festivalCalendar),
  ]);
  const byWeek = new Map(totals.map((t) => [t.week, Number(t.units ?? 0)]));
  const festivalMonths = new Set(calendar.filter((c) => c.isFestivalMonth).map((c) => c.yearMonth));
  return weeks.map((week) => {
    const thursday = new Date(isoWeekMonday(week).getTime() + 3 * 86_400_000);
    return {
      week,
      units: byWeek.get(week) ?? 0,
      festival: festivalMonths.has(thursday.toISOString().slice(0, 7)),
    };
  });
}

/** Each SKU's units sold over the 12-week rule window, oldest first, for the sparklines. */
async function getSkuSales(db: Db, nowWeek: string) {
  const weeks = weeksEndingAt(nowWeek, 12);
  const sales = await db.select().from(schema.weeklySales).where(inArray(schema.weeklySales.week, weeks));
  const map = new Map(sales.map((s) => [`${s.skuId}|${s.week}`, s.unitsSold]));
  return (skuId: string) => weeks.map((w) => map.get(`${skuId}|${w}`) ?? null);
}

const shortName =(name: string | null | undefined, skuId: string) =>
  name ? name.replace(/^Freshroots\s+/i, "") : skuId;

// Filter bar, left to right from most to least urgent. The core statuses always show (even at 0) so
// their positions don't move between runs; High demand on its own is rare, so it only shows when present.
const URGENT_FLAGS: { flag: Flag; always: boolean }[] = [
  { flag: "EXCEPTION", always: true },
  { flag: "STOCKOUT", always: true },
  { flag: "OVERSTOCK", always: true },
  { flag: "HIGH_DEMAND", always: false },
];

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ flag?: string }> }) {
  const { flag } = await searchParams;
  const db = await getDb();
  const run = await getLatestRun(db);

  if (!run) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Weekly demand plan</h1>
            <p className="muted">No recommendations yet.</p>
          </div>
        </div>
        <div className="card empty">
          <div className="empty-icon tone-accent">
            <UploadIcon size={22} />
          </div>
          <strong>Load your data to get started</strong>
          <p>
            Upload the five CSVs on the <Link href="/upload">Upload data</Link> page (or run <code>npm run db:seed</code>),
            then recalculate.
          </p>
          <div className="toolbar" style={{ justifyContent: "center" }}>
            <RecalculateForm />
          </div>
        </div>
      </>
    );
  }

  const rows = await getRunRecommendations(db, run.id);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.rec.flag, (counts.get(r.rec.flag) ?? 0) + 1);
  const needsAction = rows.filter((r) => r.rec.flag !== "NO_ACTION");
  // Default view: only the SKUs that need a decision.
  const view = flag ?? "ACTION";
  const shown = view === "ALL" ? rows : view === "ACTION" ? needsAction : rows.filter((r) => r.rec.flag === view);
  const pending = rows.filter((r) => r.rec.status === "PENDING").length;
  const unitsToOrder = rows.reduce((a, r) => a + (r.rec.action === "REORDER" ? (r.rec.quantity ?? 0) : 0), 0);
  const festival = rows.some((r) => r.evaluation.festivalMonth);
  const t = run.thresholds as Thresholds;
  const upliftPct = Math.round((t.festivalUpliftPct ?? 0) * 100);

  // Chart data (all SKUs, not just the filtered view).
  const trend = await getSalesTrend(db, run.nowWeek);
  const last12 = trend.slice(-12);
  const trendAvg12 = last12.length ? last12.reduce((a, p) => a + p.units, 0) / last12.length : null;
  const trendChange =
    trendAvg12 && last12.length >= 4 ? last12.slice(-4).reduce((a, p) => a + p.units, 0) / 4 / trendAvg12 - 1 : null;
  const mix = [...URGENT_FLAGS.map((u) => u.flag), "NO_ACTION" as Flag]
    .filter((f) => counts.has(f))
    .map((f) => ({ flag: f, label: FLAG_LABELS[f], count: counts.get(f)! }));
  const salesBySku = await getSkuSales(db, run.nowWeek);
  const health: HealthRow[] = rows.map(({ rec, sku, evaluation: e }) => ({
    skuId: rec.skuId,
    name: shortName(sku?.name, rec.skuId),
    perishable: e.perishability === "High",
    cover: e.weeksOfCover,
    stockout: e.stockoutThresholdWeeks,
    overstock: e.overstockThresholdWeeks,
    change: e.demandRatio == null ? null : e.demandRatio - 1,
    sales: salesBySku(rec.skuId),
  }));

  const kpis = [
    { label: "Awaiting review", value: pending, note: "decisions to make", tone: "tone-accent", Icon: ClockIcon, href: "/review" },
    { label: "Exceptions", value: counts.get("EXCEPTION") ?? 0, note: "need a planner's judgement", tone: "tone-exception", Icon: AlertIcon, href: "/?flag=EXCEPTION" },
    { label: "Stockout risk", value: counts.get("STOCKOUT") ?? 0, note: "cover below threshold", tone: "tone-stockout", Icon: TrendUpIcon, href: "/?flag=STOCKOUT" },
    { label: "Overstock risk", value: counts.get("OVERSTOCK") ?? 0, note: "pause the next order", tone: "tone-overstock", Icon: BoxIcon, href: "/?flag=OVERSTOCK" },
    { label: "Units to order", value: unitsToOrder, note: "before review", tone: "tone-ok", Icon: TruckIcon, href: "/review" },
  ];

  const chip = (key: string, label: string, n: number) => (
    <Link
      key={key}
      href={key === "ACTION" ? "/" : `/?flag=${key}`}
      className={`chip chip-${key} ${view === key ? "active" : ""} ${n === 0 ? "empty" : ""}`}
      aria-current={view === key ? "page" : undefined}
    >
      <span className="chip-dot" aria-hidden="true" />
      {label}
      <span className="n">{n}</span>
    </Link>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Week {run.nowWeek}</div>
          <h1>Weekly demand plan</h1>
          <div className="subtitle">
            <span>Run #{run.id}</span>
            <span className="dot" />
            <span>
              Updated {fmtDateTime(run.createdAt)} by {run.triggeredBy}
            </span>
            {festival && (
              <>
                <span className="dot" />
                <span className="badge no-dot tone-overstock">Festival month · +{upliftPct}% demand</span>
              </>
            )}
          </div>
        </div>
        <div className="toolbar">
          <GenerateExplanationsForm enabled={geminiConfigured()} />
          <RecalculateForm />
        </div>
      </div>

      <div className="kpis">
        {kpis.map(({ label, value, note, tone, Icon, href }) => (
          <Link key={label} href={href} className="kpi">
            <span className="kpi-label">
              <span className={`kpi-icon ${tone}`}>
                <Icon size={16} />
              </span>
              {label}
            </span>
            <span className="kpi-value">{fmtInt(value)}</span>
            <span className="kpi-note">{note}</span>
          </Link>
        ))}
      </div>

      <div className="chart-grid">
        <div className="card chart-card span-2">
          <div className="card-head">
            <div>
              <h2>Total sales, last {TREND_WEEKS} weeks</h2>
              <div className="muted small">Units sold per week across all SKUs</div>
            </div>
            {trendChange != null && (
              <span className={`badge no-dot ${trendChange >= 0 ? "tone-ok" : "tone-stockout"}`}>
                {trendChange >= 0 ? "▲" : "▼"} {Math.abs(Math.round(trendChange * 1000) / 10)}% last 4 wks vs 12-wk avg
              </span>
            )}
          </div>
          <SalesTrendChart data={trend} avg12={trendAvg12} />
        </div>
        <div className="card chart-card">
          <div className="card-head">
            <div>
              <h2>Status mix</h2>
              <div className="muted small">SKUs by engine status this week</div>
            </div>
          </div>
          <StatusMixChart data={mix} />
        </div>
        <div className="card chart-card span-full">
          <div className="card-head">
            <div>
              <h2>Stock health by SKU</h2>
              <div className="muted small">
                Sales trend, demand change (last 4 weeks vs 12-week average; past +
                {Math.round(t.highDemandPct * 100)}% is high demand) and where cover sits against each SKU&apos;s limits
              </div>
            </div>
          </div>
          <StockHealth rows={health} highDemandPct={t.highDemandPct} />
        </div>
      </div>

      <div className="filter-bar">
        <nav className="filters" aria-label="Filter recommendations">
          {chip("ACTION", "Needs action", needsAction.length)}
          <span className="filter-sep" aria-hidden="true" />
          {URGENT_FLAGS.filter((u) => u.always || counts.has(u.flag)).map((u) =>
            chip(u.flag, FLAG_LABELS[u.flag], counts.get(u.flag) ?? 0),
          )}
          <span className="filter-sep" aria-hidden="true" />
          {chip("NO_ACTION", FLAG_LABELS.NO_ACTION, counts.get("NO_ACTION") ?? 0)}
          {chip("ALL", "All SKUs", rows.length)}
        </nav>
        <span className="muted small">
          Showing {shown.length} of {rows.length} SKUs
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="card empty">
          <div className="empty-icon tone-ok">
            <SparkIcon size={22} />
          </div>
          <strong>Nothing here</strong>
          <p>No SKUs match this filter in the latest run.</p>
        </div>
      ) : (
        <div className="table-wrap fit">
          {/* Fixed column widths so the table always fits the page; on phones each row becomes a card. */}
          <table className="table dash-table">
            <colgroup>
              <col className="c-product" />
              <col className="c-stock" />
              <col className="c-demand" />
              <col className="c-cover" />
              <col className="c-status" />
              <col className="c-action" />
              <col className="c-why" />
            </colgroup>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">On hand</th>
                <th className="num" title="12-week average; festival baseline underneath">
                  Demand / wk
                </th>
                <th className="num">Weeks of cover</th>
                <th>Status</th>
                <th>Recommendation</th>
                <th className="c-why">Why</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ rec, sku, ai, evaluation: e }) => {
                const reason = ai?.reason ?? rec.reason;
                return (
                  <tr key={rec.id}>
                    <td>
                      <Link href={`/sku/${rec.skuId}`} className="product-name">
                        {sku?.name ?? rec.skuId}
                      </Link>
                      <div className="product-meta">
                        {rec.skuId}
                        {e.perishability === "High" && (
                          <>
                            {" "}
                            · <span className="tag perishable">Perishable</span>
                          </>
                        )}
                        {!sku && " · not in SKU master"}
                      </div>
                    </td>
                    <td className="num" data-label="On hand">
                      {fmtInt(e.unitsOnHand)}
                      {(e.unitsOnOrder ?? 0) > 0 && (
                        <div className="product-meta on-order" title="Open purchase orders, not yet received">
                          +{fmtInt(e.unitsOnOrder)} on order
                        </div>
                      )}
                    </td>
                    <td className="num" data-label="Demand / wk">
                      {fmt1(e.avg12)}
                      {e.festivalMonth && e.demandBaseline != null && (
                        <div className="product-meta" title="Festival-month baseline used for cover">
                          festival {fmt1(e.demandBaseline)}
                        </div>
                      )}
                    </td>
                    <td className="num" data-label="Weeks of cover">
                      <CoverBar
                        weeks={e.weeksOfCover}
                        stockout={e.stockoutThresholdWeeks}
                        overstock={e.overstockThresholdWeeks}
                      />
                    </td>
                    <td data-label="Status">
                      <FlagBadge flag={rec.flag} />
                    </td>
                    <td data-label="Recommendation">
                      <ActionText action={rec.action} quantity={rec.quantity} />
                      {rec.status !== "NO_ACTION" && (
                        <div className="review-state">
                          <StatusBadge status={rec.status} />
                          {rec.finalQuantity != null && rec.finalQuantity !== rec.quantity && (
                            <span className="product-meta"> final {fmtInt(rec.finalQuantity)}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="c-why">
                      <div className="clamp muted" title={reason}>
                        {ai?.reason && (
                          <span className="ai-tag">
                            <SparkIcon size={11} /> AI ·{" "}
                          </span>
                        )}
                        {reason}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small" style={{ marginTop: 12 }}>
        Weekly demand is the 12-week average. In festival months, weeks of cover uses the uplifted baseline shown
        underneath. The bar is green inside the healthy range, red below the stockout limit and amber above the
        overstock limit.
      </p>
    </>
  );
}
