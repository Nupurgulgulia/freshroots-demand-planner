"use client";

import {
  Bar,
  Cell,
  CartesianGrid,
  ComposedChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function SalesChart({
  data,
  avg12,
  baseline,
}: {
  data: { week: string; units: number | null; inLast12: boolean }[];
  avg12: number | null;
  baseline: number | null;
}) {
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="week" tickFormatter={(w: string) => w.slice(5)} tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} width={44} />
          <Tooltip formatter={(v) => [v ?? "no data", "Units sold"]} />
          <Legend />
          <Bar dataKey="units" name="Units sold" fill="var(--bar)" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {/* Weeks outside the 12-week window are shown lighter. */}
            {data.map((d) => (
              <Cell key={d.week} fill={d.inLast12 ? "var(--bar)" : "var(--bar-old)"} />
            ))}
          </Bar>
          {avg12 != null && (
            <ReferenceLine
              y={avg12}
              stroke="var(--ref)"
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
              label={{ value: "12-wk avg", position: "insideTopLeft", fontSize: 11 }}
            />
          )}
          {baseline != null && baseline !== avg12 && (
            <ReferenceLine
              y={baseline}
              stroke="var(--ref2)"
              strokeDasharray="2 3"
              ifOverflow="extendDomain"
              label={{ value: "Baseline (festival)", position: "insideTopRight", fontSize: 11 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
