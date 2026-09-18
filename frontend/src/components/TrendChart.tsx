import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistoryPoint } from "../../../shared/src/index.js";
import { CATEGORY_META, categoryOf } from "../lib/risk";

interface Props {
  points: HistoryPoint[];
  unit: string;
  warningLevel: number;
  dangerLevel: number;
}

export function TrendChart({ points, unit, warningLevel, dangerLevel }: Props) {
  const data = points.map((p) => ({
    t: new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    v: p.v,
  }));
  const last = points[points.length - 1];
  const stroke = CATEGORY_META[last ? categoryOf(last.riskScore ?? 0) : "Normal"].color;
  // Y-axis precision must scale with the data range: for a narrow range such
  // as 61.08–61.11 m a fixed `toFixed(1)` renders "61.1" on every gridline and
  // the axis becomes useless. Use enough decimals so tick labels distinguish.
  let yTicksDecimals = 1;
  if (points.length) {
    const lo = Math.min(...points.map((p) => p.v));
    const hi = Math.max(...points.map((p) => p.v));
    const span = Math.max(1e-9, hi - lo);
    if (span < 0.01) yTicksDecimals = 4;
    else if (span < 0.1) yTicksDecimals = 3;
    else if (span < 1) yTicksDecimals = 2;
  }
  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <CartesianGrid stroke="#1a2740" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            stroke="#475569"
            tick={{ fontSize: 10, fontFamily: "IBM Plex Mono" }}
            minTickGap={40}
          />
          <YAxis
            domain={["auto", "auto"]}
            stroke="#475569"
            tick={{ fontSize: 10, fontFamily: "IBM Plex Mono" }}
            width={52}
            tickFormatter={(v: number) => Number.isFinite(v) ? v.toFixed(yTicksDecimals) : ""}
          />
          <Tooltip
            contentStyle={{
              background: "#0d1424",
              border: "1px solid #22304a",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(l) => `observed ${String(l)}`}
            formatter={(v) => [`${Number(v).toFixed(2)} ${unit}`, "level"]}
          />
          <ReferenceLine
            y={warningLevel}
            stroke="#fbbf24"
            strokeDasharray="6 4"
            strokeWidth={1.5}
            label={{ value: `warning ${warningLevel}`, fill: "#fbbf24", fontSize: 10, fontFamily: "IBM Plex Mono", position: "insideTopRight" }}
          />
          <ReferenceLine
            y={dangerLevel}
            stroke="#f87171"
            strokeDasharray="6 4"
            strokeWidth={1.5}
            label={{ value: `danger ${dangerLevel}`, fill: "#f87171", fontSize: 10, fontFamily: "IBM Plex Mono", position: "insideBottomRight" }}
          />
          <Line
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}