import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { AlertDTO, HistoryPoint, IntervalStats, StationDTO } from "../../../shared/src/index.js";
import { get } from "../lib/api";
import { subscribe } from "../lib/socket";
import { CATEGORY_META } from "../lib/risk";
import { fmtLevel, fmtProjHours, fmtRise, fmtRelative } from "../lib/format";
import { RiskBadge } from "../components/RiskBadge";
import { TrendChart } from "../components/TrendChart";

const HOURS_OPTIONS = [6, 12, 24, 48, 72];

export function StationDetail() {
  const { id } = useParams<{ id: string }>();
  const [station, setStation] = useState<StationDTO | null>(null);
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [interval, setInterval] = useState<IntervalStats | null>(null);
  const [hours, setHours] = useState(72);
  const [alerts, setAlerts] = useState<AlertDTO[]>([]);

  useEffect(() => {
    if (!id) return;
    get<{ station: StationDTO }>(`/api/stations/${id}`).then((r) => setStation(r.station)).catch(() => undefined);
    const unsub = subscribe<StationDTO>("station:update", (st) => {
      if (st.id === id) setStation(st);
    });
    return unsub;
  }, [id]);

  useEffect(() => {
    if (!id) return;
    get<{ points: HistoryPoint[]; stats: IntervalStats }>(`/api/stations/${id}/history?hours=${hours}`)
      .then((r) => {
        setPoints(r.points);
        setInterval(r.stats);
      })
      .catch(() => undefined);
  }, [id, hours]);

  useEffect(() => {
    if (!id) return;
    get<{ alerts: AlertDTO[] }>("/api/alerts")
      .then((r) => setAlerts(r.alerts.filter((a) => a.stationId === id)))
      .catch(() => undefined);
    const u1 = subscribe<AlertDTO>("alert:new", (a) => {
      if (a.stationId === id) setAlerts((prev) => [a, ...prev]);
    });
    return u1;
  }, [id]);

  const meta = station?.latest ? CATEGORY_META[station.latest.category] : CATEGORY_META["No data"];

  const proximities = useMemo(() => {
    if (!station) return null;
    const range = Math.max(1e-6, station.dangerLevel - station.normalLevel);
    return {
      warning: Math.round(((station.warningLevel - station.normalLevel) / range) * 100),
      danger: 100,
    };
  }, [station]);

  if (!station) {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center text-slate-500 mono">loading station…</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <Link to="/" className="text-xs text-slate-500 hover:text-accent mono">← all stations</Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-white">{station.name}</h1>
            {station.latest ? (
              <RiskBadge category={station.latest.category} score={station.latest.riskScore} />
            ) : (
              <RiskBadge category="No data" />
            )}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {station.place} · {station.kind} ·{" "}
            <span className={station.simulated ? "text-purple-400" : "text-cyan-400"}>{station.sourceLabel}</span>
            {station.latest && <> · updated {fmtRelative(station.latest.observedAt)}</>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {HOURS_OPTIONS.map((h) => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className={`px-2.5 py-1 rounded-md mono text-[11px] border transition-colors ${
                hours === h ? "border-accent/60 text-accent bg-accent/10" : "border-line text-slate-500 hover:text-slate-300"
              }`}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      {/* Key numbers */}
      <div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className={`panel p-4 ${meta ? "" : ""}`} style={meta ? { borderLeft: `3px solid ${meta.color}` } : undefined}>
          <div className="panel-head">current level</div>
          <div className="mt-2 mono text-3xl leading-none text-slate-100 font-semibold">
            {fmtLevel(station.latest?.level, station.unit, station.levelBasis)}
          </div>
          <div className={`text-[11px] mono mt-1 ${station.latest?.rateOfRise ? meta.text : "text-slate-600"}`}>
            {station.latest
              ? station.latest.rateOfRise != null && station.latest.rateOfRise !== 0
                ? `rising ${fmtRise(station.latest.rateOfRise)}`
                : "rate of rise: 0"
              : "no readings yet"}
          </div>
        </div>
        <div className="panel p-4">
          <div className="panel-head">risk score</div>
          <div className="mt-2 mono text-3xl leading-none text-slate-100 font-semibold">
            {station.latest?.riskScore ?? "—"}/100
          </div>
          {meta && <div className={`text-[11px] mt-1 ${meta.text}`}>{station.latest?.category ?? "No data"}</div>}
        </div>
        <div className="panel p-4">
          <div className="panel-head">normal level</div>
          <div className="mt-2 mono text-3xl leading-none text-emerald-300 font-semibold">
            {fmtLevel(station.normalLevel, station.unit)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">baseline</div>
        </div>
        <div className="panel p-4">
          <div className="panel-head">warning level</div>
          <div className="mt-2 mono text-3xl leading-none text-amber-300 font-semibold">
            {fmtLevel(station.warningLevel, station.unit)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 mono">{proximities?.warning}% of danger range</div>
        </div>
        <div className="panel p-4">
          <div className="panel-head">danger level</div>
          <div className="mt-2 mono text-3xl leading-none text-red-400 font-semibold">
            {fmtLevel(station.dangerLevel, station.unit)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">highest on record / max</div>
        </div>
      </div>

      {/* Why this score — explainable risk (no fake AI) */}
      {station.latest?.explain && (
        <div className="mt-4 panel p-4" style={{ borderLeft: `3px solid ${meta.color}` }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="panel-head">Why this score · {station.latest.riskScore}/100 ({station.latest.category})</h2>
            <span className="text-[10px] mono text-slate-600">score = proximity·{station.riskConfig.weightProximity} + rise·{station.riskConfig.weightRise} + rain·{station.riskConfig.weightRain}</span>
          </div>
          <p className="mt-2 text-[13px] text-slate-300 leading-relaxed">{station.latest.explain.whyThisScore}</p>
          <div className="mt-3 grid sm:grid-cols-3 gap-3">
            {station.latest.explain.contributions.map((c) => (
              <div key={c.key} className="rounded-md border border-line bg-ink-850 p-3">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">{c.label}</span>
                  <span className="mono text-slate-200">{Math.round(c.normalized * 100)}% norm</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-ink-900 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, c.normalized * 100)}%`, background: meta.color }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[10px] mono text-slate-500">
                  <span>weight {Math.round(c.weight)}%</span>
                  <span>{c.percentOfScore}% of score</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Time-to-threshold projection */}
      {station.latest && (
        <div className={`mt-4 panel p-4 ${station.latest.projection && (station.latest.projection.hoursToWarning != null || station.latest.projection.hoursToDanger != null) ? "border-accent/40" : ""}`}>
          <div className="panel-head">prediction · ESTIMATED TIME to threshold</div>
          {(() => {
            const p = station.latest.projection;
            if (p && (p.hoursToWarning != null || p.hoursToDanger != null)) {
              return (
                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
                  {p.hoursToWarning != null && (
                    <span className="text-[12px] mono text-amber-300">
                      ⏳ Warning <b>est. {fmtProjHours(p.hoursToWarning)}</b> away
                    </span>
                  )}
                  {p.hoursToDanger != null && (
                    <span className="text-[12px] mono text-red-300">
                      🚨 Danger <b>est. {fmtProjHours(p.hoursToDanger)}</b> away
                    </span>
                  )}
                  <span className="text-[11px] text-slate-500 ml-auto">
                    linear extrapolation from current rise {fmtRise(station.latest.rateOfRise)} · {station.latest.observedAt ? `last reading ${fmtRelative(station.latest.observedAt)}` : ""}
                  </span>
                </div>
              );
            }
            const rate = station.latest.rateOfRise;
            return rate == null || rate <= 0 ? (
              <div className="mt-2 text-[12px] text-slate-400">
                {rate == null
                  ? "Insufficient trend data — the gauge has not reported recently, so no estimate is shown."
                  : "Insufficient trend data — the level is not rising, so no time-to-threshold estimate is shown."}{" "}
                <span className="text-slate-600">(no estimates are invented here)</span>
              </div>
            ) : (
              <div className="mt-2 text-[12px] text-slate-400">
                rising {fmtRise(rate)} — but not enough margin to estimate a threshold crossing within the forecast window.
              </div>
            );
          })()}
        </div>
      )}

      {/* Chart */}
      <div className="mt-4 panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="panel-head">Level trend · last {hours}h</h2>
          {interval && (
            <span className="text-[11px] mono text-slate-500">
              min {interval.min?.toFixed(2)} · avg {interval.avg?.toFixed(2)} · max {interval.max?.toFixed(2)} {station.unit}
            </span>
          )}
        </div>
        <div className="mt-3">
          {points.length === 0 ? (
            <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-line text-center">
              <div>
                <div className="text-[12px] text-slate-400">no readings in the last {hours}h</div>
                <div className="text-[11px] text-slate-600 mt-1 mono">
                  {station.latest ? `gauge last reported ${fmtRelative(station.latest.observedAt)}` : "no readings for this gauge yet"}
                </div>
              </div>
            </div>
          ) : (
            <TrendChart points={points} unit={station.unit} warningLevel={station.warningLevel} dangerLevel={station.dangerLevel} />
          )}
        </div>
        <div className="mt-2 flex gap-4 text-[11px] text-slate-500 flex-wrap">
          <span className="flex items-center gap-1.5"><span className="w-3 border-t-2 border-dashed border-amber-400" /> warning level</span>
          <span className="flex items-center gap-1.5"><span className="w-3 border-t-2 border-dashed border-red-400" /> danger level</span>
          <span className="ml-auto">
            risk formula: proximity · {station.riskConfig.weightProximity} + rate-of-rise · {station.riskConfig.weightRise} + rain ·{" "}
            {station.riskConfig.weightRain}
          </span>
        </div>
      </div>

      {/* Alerts for this station */}
      <div className="mt-4 panel overflow-hidden">
        <div className="px-4 py-2.5 border-b border-line">
          <h2 className="panel-head">Alerts for this station</h2>
        </div>
        <div className="px-4 py-3">
          {alerts.length === 0 ? (
            <div className="text-sm text-slate-500 text-center py-4">no alerts triggered for this station</div>
          ) : (
            <ul className="divide-y divide-line dim">
              {alerts.map((a) => (
                <li key={a.id} className="py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <RiskBadge category={a.category} score={a.riskScore} size="sm" />
                    <span className="text-[10px] uppercase mono text-slate-500">via {a.channel} → {a.sentTo}</span>
                    <span className="ml-auto text-[11px] text-slate-500 mono">{fmtRelative(a.createdAt)}</span>
                  </div>
                  {a.level != null && a.normalLevel != null && a.warningLevel != null && a.dangerLevel != null && (
                    <div className="mt-1 text-[11px] mono text-slate-500">
                      level <span className="text-slate-300">{fmtLevel(a.level, a.unit ?? "")}</span> · warning {fmtLevel(a.warningLevel, a.unit ?? "")} · danger {fmtLevel(a.dangerLevel, a.unit ?? "")}
                      {a.rateOfRise != null && <> · rise {fmtRise(a.rateOfRise)}</>}
                      {a.projectionHoursToDanger != null && <span className="text-red-300"> · est. danger in {fmtProjHours(a.projectionHoursToDanger)}</span>}
                    </div>
                  )}
                  <div className="text-[11px] mt-1">
                    {a.acknowledgedAt ? (
                      <span className="text-emerald-400">✓ acknowledged by {a.acknowledgedBy}</span>
                    ) : (
                      <span className="text-amber-400/80">awaiting acknowledgement</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}