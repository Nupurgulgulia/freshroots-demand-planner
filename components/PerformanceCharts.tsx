"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const axisTick = { fontSize: 11, fill: "var(--muted)" };
const tooltipStyle = {
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  boxShadow: "var(--shadow-lg)",
  fontSize: 12,
};
const pct = (v: unknown) => (v == null ? "—" : `${Math.round(Number(v) * 1000) / 10}%`);
const inr = (v: unknown) =>
  v == null
    ? "—"
    : Number(v).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inrShort = (v: number) =>
  v >= 1e7 ? `₹${Math.round(v / 1e5) / 100}Cr` : v >= 1e5 ? `₹${Math.round(v / 1e3) / 100}L` : `₹${Math.round(v / 1000)}k`;

export type TrendPoint = {
  label: string;
  accuracy: number | null;
  overrideRate: number | null;
  turnaroundHours: number | null;
};

/** Forecast accuracy per run (only runs with 4 weeks of sales after them have a value). */
export function AccuracyTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis
          domain={[0, 1]}
          tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
          tick={axisTick}
          width={42}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [pct(v), "Forecast accuracy"]} />
        <Line
          type="monotone"
          dataKey="accuracy"
          stroke="var(--bar)"
          strokeWidth={2.5}
          dot={{ r: 3.5, fill: "var(--bar)", strokeWidth: 0 }}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Override rate (bars, left axis) and median review time in hours (line, right axis) per run. */
export function ReviewTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 10, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis
          yAxisId="rate"
          domain={[0, 1]}
          tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
          tick={axisTick}
          width={42}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="hours"
          orientation="right"
          tickFormatter={(v: number) => `${v}h`}
          tick={axisTick}
          width={40}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v, name) =>
            name === "Override rate" ? [pct(v), name] : [v == null ? "—" : `${Math.round(Number(v) * 10) / 10} h`, name]
          }
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar
          yAxisId="rate"
          dataKey="overrideRate"
          name="Override rate"
          fill="var(--cover-high)"
          radius={[5, 5, 0, 0]}
          maxBarSize={28}
          isAnimationActive={false}
        />
        <Line
          yAxisId="hours"
          type="monotone"
          dataKey="turnaroundHours"
          name="Median review time"
          stroke="var(--high-fg)"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export type FiguresPoint = { quarter: string; baseline: number | null; target: number | null; actual: number | null };

/** Entered quarterly losses: baseline vs target vs actual. */
export function LossesChart({ data }: { data: FiguresPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }} barGap={3}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="quarter" tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={inrShort} tick={axisTick} width={52} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [inr(v), `${name} (entered)`]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="baseline" name="Baseline" fill="var(--faint)" radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
        <Bar dataKey="target" name="Target" fill="var(--high-fg)" radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
        <Bar dataKey="actual" name="Actual" fill="var(--bar)" radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Total units on hand at each stock upload. */
export function StockHistoryChart({ data }: { data: { label: string; units: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={axisTick} width={48} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [Number(v).toLocaleString("en-IN"), "Units on hand"]} />
        <Line
          type="stepAfter"
          dataKey="units"
          stroke="var(--accent)"
          strokeWidth={2}
          dot={{ r: 3 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
