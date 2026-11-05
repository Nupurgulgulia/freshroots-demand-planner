"use client";

import {
  Area,
  CartesianGrid,
  Cell,
  ComposedChart,
  Pie,
  PieChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type TrendPoint = { week: string; units: number; festival: boolean };
export type MixSlice = { flag: string; label: string; count: number };

// Same colours as the status badges in the table.
const FLAG_COLOR: Record<string, string> = {
  EXCEPTION: "var(--exception-fg)",
  STOCKOUT: "var(--cover-low)",
  OVERSTOCK: "var(--cover-high)",
  HIGH_DEMAND: "var(--high-fg)",
  NO_ACTION: "var(--cover-ok)",
};

const axisTick = { fontSize: 11, fill: "var(--muted)" };

const tooltipStyle = {
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  boxShadow: "var(--shadow-lg)",
  fontSize: 12,
};

const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 1 });

/** Total units sold per week across all SKUs, festival weeks shaded. */
export function SalesTrendChart({ data, avg12 }: { data: TrendPoint[]; avg12: number | null }) {
  const fest = data.filter((d) => d.festival);
  return (
    <ResponsiveContainer width="100%" height={230}>
      <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--bar)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--bar)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        {fest.length > 0 && (
          <ReferenceArea
            x1={fest[0].week}
            x2={fest[fest.length - 1].week}
            fill="var(--overstock-bg)"
            fillOpacity={0.6}
            ifOverflow="extendDomain"
            label={{ value: "Festival", position: "insideTopLeft", fontSize: 11, fill: "var(--overstock-fg)" }}
          />
        )}
        <XAxis dataKey="week" tickFormatter={(w: string) => w.slice(5)} tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis
          tick={axisTick}
          width={48}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => fmt(v)}
          // Zoom in on the range the sales actually move in, rather than starting at 0.
          domain={[(min: number) => Math.floor((min * 0.9) / 100) * 100, (max: number) => Math.ceil((max * 1.05) / 100) * 100]}
        />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmt(Number(v)), "Units sold"]} />
        {avg12 != null && (
          <ReferenceLine
            y={avg12}
            stroke="var(--ref)"
            strokeDasharray="4 4"
            ifOverflow="extendDomain"
            label={{ value: "12-wk avg", position: "insideBottomLeft", fontSize: 11, fill: "var(--muted)" }}
          />
        )}
        <Area
          type="monotone"
          dataKey="units"
          stroke="var(--bar)"
          strokeWidth={2.5}
          fill="url(#trendFill)"
          dot={{ r: 2.5, fill: "var(--bar)", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Donut of SKUs by status, with the total in the middle. */
export function StatusMixChart({ data }: { data: MixSlice[] }) {
  const total = data.reduce((a, d) => a + d.count, 0);
  return (
    <div className="mix">
      <div className="mix-chart">
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="label"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell key={d.flag} fill={FLAG_COLOR[d.flag] ?? "var(--faint)"} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`${v} SKUs`, String(name)]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="mix-center">
          <span className="mix-total">{total}</span>
          <span className="mix-label">SKUs</span>
        </div>
      </div>
      <ul className="mix-legend">
        {data.map((d) => (
          <li key={d.flag}>
            <span className="chip-dot" style={{ background: FLAG_COLOR[d.flag] }} />
            <span>{d.label}</span>
            <strong>{d.count}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
