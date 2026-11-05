import Link from "next/link";
import { fmt1 } from "@/lib/format";

export type HealthRow = {
  skuId: string;
  name: string;
  perishable: boolean;
  cover: number | null;
  stockout: number;
  overstock: number;
  /** 4-week vs 12-week demand change, as a fraction (0.21 = +21%). */
  change: number | null;
  /** Units sold in each of the last 12 weeks, oldest first (null = no data). */
  sales: (number | null)[];
};

// Each SKU's own thresholds are mapped onto the same three zones, so a perishable with a 3/4-week
// band and a regular SKU with a 6/14-week band line up and can be compared at a glance.
const LOW_END = 30; // % of the bar where the stockout limit sits
const OK_END = 72; // % of the bar where the overstock limit sits

function coverPosition(cover: number, stockout: number, overstock: number) {
  if (cover <= stockout) return (cover / stockout) * LOW_END;
  if (cover <= overstock) return LOW_END + ((cover - stockout) / (overstock - stockout)) * (OK_END - LOW_END);
  // Above overstock: the amber zone runs to 2× the overstock limit, then clamps.
  return Math.min(100, OK_END + ((cover - overstock) / overstock) * (100 - OK_END));
}

function zone(cover: number, stockout: number, overstock: number) {
  return cover < stockout ? "low" : cover > overstock ? "high" : "ok";
}

function Sparkline({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null);
  if (pts.length < 2) return <span className="spark" />;
  const ys = pts.map((p) => p[1]);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const w = 84;
  const h = 26;
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => (max === min ? h / 2 : h - 3 - ((v - min) / (max - min)) * (h - 6));
  const line = pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polygon points={`${x(pts[0][0])},${h} ${line} ${x(lx)},${h}`} className="spark-fill" />
      <polyline points={line} className="spark-line" />
      <circle cx={x(lx)} cy={y(ly)} r={2.4} className="spark-dot" />
    </svg>
  );
}

function Momentum({ change, highDemandPct }: { change: number | null; highDemandPct: number }) {
  if (change == null) return <span className="momentum flat">—</span>;
  const pct = Math.round(change * 1000) / 10;
  const cls = change > highDemandPct ? "hot" : change > 0.005 ? "up" : change < -0.005 ? "down" : "flat";
  const arrow = cls === "hot" || cls === "up" ? "▲" : cls === "down" ? "▼" : "■";
  return (
    <span className={`momentum ${cls}`} title="Last 4 weeks vs 12-week average">
      {arrow} {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}

export function StockHealth({ rows, highDemandPct }: { rows: HealthRow[]; highDemandPct: number }) {
  const sorted = rows
    .filter((r) => r.cover != null)
    .map((r) => ({ ...r, pos: coverPosition(r.cover!, r.stockout, r.overstock) }))
    .sort((a, b) => a.pos - b.pos);

  return (
    <>
      <div className="health-legend">
        <span>
          <i className="z-low" /> Stockout risk
        </span>
        <span>
          <i className="z-ok" /> Healthy cover
        </span>
        <span>
          <i className="z-high" /> Overstock
        </span>
        <span className="muted">
          Each bar uses that SKU&apos;s own limits, so perishables (P) compare fairly. Sorted from most to least at risk of running out.
        </span>
      </div>
      {/* The list flows into two columns on wide screens, so the header is repeated for the second one. */}
      <div className="health-heads" aria-hidden="true">
        {[0, 1].map((i) => (
          <div key={i} className="health-head">
            <span>Product</span>
            <span>12-wk sales</span>
            <span>Demand</span>
            <span>Weeks of cover</span>
          </div>
        ))}
      </div>
      <ul className="health-list">
        {sorted.map((r) => {
          const z = zone(r.cover!, r.stockout, r.overstock);
          return (
            <li key={r.skuId}>
              <Link href={`/sku/${r.skuId}`} className="health-row">
                <span className="health-name" title={r.name}>
                  <span className="nm">{r.name}</span>
                  {r.perishable && <span className="tag perishable">P</span>}
                </span>
                <Sparkline values={r.sales} />
                <Momentum change={r.change} highDemandPct={highDemandPct} />
                <span
                  className="bullet"
                  title={`${fmt1(r.cover)} weeks of cover · stockout below ${r.stockout}, overstock above ${r.overstock}`}
                >
                  <span className="bullet-track">
                    <span className="seg z-low" style={{ width: `${LOW_END}%` }} />
                    <span className="seg z-ok" style={{ width: `${OK_END - LOW_END}%` }} />
                    <span className="seg z-high" style={{ width: `${100 - OK_END}%` }} />
                    <span className={`marker m-${z}`} style={{ left: `${r.pos}%` }} />
                  </span>
                  <span className={`bullet-value v-${z}`}>{fmt1(r.cover)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
