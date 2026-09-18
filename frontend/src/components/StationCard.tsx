import { useNavigate } from "react-router-dom";
import type { StationDTO } from "../../../shared/src/index.js";
import { CATEGORY_META } from "../lib/risk";
import { fmtLevel, fmtProjHours, fmtRelative, fmtRise } from "../lib/format";
import { RiskBadge } from "./RiskBadge";
import { Sparkline } from "./Sparkline";

export function StationCard({ station, onSelect }: { station: StationDTO; onSelect?: () => void }) {
  const nav = useNavigate();
  const cat = station.latest?.category ?? "No data";
  const meta = CATEGORY_META[cat];
  const pulse = cat === "Severe" || cat === "Critical";

  return (
    <button
      onClick={() => {
        onSelect?.();
        nav(`/station/${station.id}`);
      }}
      className="panel group relative w-full text-left overflow-hidden transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${meta.edge}`} />
      <div className="pl-4 pr-4 py-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium text-sm text-slate-100 group-hover:text-white">{station.name}</div>
            <div className="truncate text-[11px] text-slate-500 mt-0.5">{station.place}</div>
          </div>
          <RiskBadge category={cat} score={station.latest?.riskScore} size="sm" />
        </div>

        <div className="flex items-end justify-between mt-2">
          <div>
            <div className="mono text-2xl leading-none text-slate-100">
              {fmtLevel(station.latest?.level, station.unit, station.levelBasis)}
            </div>
            <div className={`text-[11px] mt-1 mono ${station.latest?.rateOfRise ? meta.text : "text-slate-500"}`}>
              {fmtRise(station.latest?.rateOfRise)}
              {pulse && <span className="ml-2 text-[10px] font-semibold tracking-wider">▲ RISING</span>}
            </div>
          </div>
          <div className="w-24">
            <Sparkline points={station.recent} color={meta.color} unit={station.unit} />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <span className="chip bg-ink-800 border border-line text-slate-400">{station.kind}</span>
          <span
            className={`chip border ${
              station.simulated
                ? "bg-purple-500/10 border-purple-500/30 text-purple-300"
                : station.source === "nwdp"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-cyan-500/10 border-cyan-500/30 text-cyan-300"
            }`}
          >
            {station.simulated ? "simulated" : station.sourceLabel}
          </span>
          {station.latest && (
            <span className="ml-auto text-[10px] text-slate-500 mono">{fmtRelative(station.latest.observedAt)}</span>
          )}
        </div>

        {/* Time-to-threshold projection (appears only while the water is rising) */}
        {(() => {
          const p = station.latest?.projection;
          if (!p || p.hoursToWarning == null) return null;
          return (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] mono font-semibold text-amber-300">
                ≈{fmtProjHours(p.hoursToWarning)} to Warning
              </span>
              {p.hoursToDanger != null && (
                <span className="text-[10px] mono text-red-300/80">
                  · {fmtProjHours(p.hoursToDanger)} to Danger
                </span>
              )}
              <span className="text-[10px] text-slate-600">(linear estimate)</span>
            </div>
          );
        })()}
      </div>
    </button>
  );
}