import { Line, LineChart, ResponsiveContainer } from "recharts";

export function Sparkline({ points, color, unit = "m" }: { points: { t: number; v: number }[]; color: string; unit?: string }) {
  const data = points.map((p) => ({ i: p.t, v: p.v }));
  if (data.length < 2) {
    return <div className="h-10 flex items-center justify-center text-slate-600 text-[10px] mono">no history yet</div>;
  }
  return (
    <div className="h-10">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}