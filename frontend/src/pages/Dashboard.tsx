import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { NationalStats, StationDTO } from "../../../shared/src/index.js";
import { get } from "../lib/api";
import { subscribe } from "../lib/socket";
import { CATEGORY_META, CATEGORY_ORDER } from "../lib/risk";
import { fmtDateTime, fmtLevel, fmtProjHours, fmtRelative } from "../lib/format";
import { MapView, isIndiaStation } from "../components/MapView";
import { StationCard } from "../components/StationCard";

function computeStats(stations: StationDTO[]): NationalStats {
  const scores = stations
    .map((s) => s.latest?.riskScore)
    .filter((v): v is number => typeof v === "number");
  const byCategory = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as NationalStats["byCategory"];
  let updated: number | null = null;
  for (const s of stations) {
    if (s.latest) {
      byCategory[s.latest.category] += 1;
      const t = new Date(s.latest.observedAt).getTime();
      updated = Math.max(updated ?? 0, t);
    }
  }
  return {
    nationalIndex: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    totalStations: stations.length,
    withReadings: scores.length,
    byCategory,
    updatedAt: updated ? new Date(updated).toISOString() : null,
  };
}

/** Operational metrics surfaced on the dashboard (item 6). */
function operationalMetrics(stations: StationDTO[]) {
  const active = stations.filter((s) => {
    const c = s.latest?.category;
    return c === "Warning" || c === "Severe" || c === "Critical";
  });
  const activeRegions = [...new Set(active.map((s) => s.region ?? "unknown").filter(Boolean))].sort();
  // Same source as the station cards' "≈Xh to Danger": the server-computed
  // projection on each latest reading. Minimum hours across ALL India stations
  // with a non-null estimate (a "Watch" rising site counts too, exactly as its
  // card shows it) — not a separately-triggered, active-only filter.
  const withProjection = stations
    .map((s) => ({ name: s.name, h: s.latest?.projection?.hoursToDanger }))
    .filter((x): x is { name: string; h: number } => typeof x.h === "number" && Number.isFinite(x.h))
    .sort((a, b) => a.h - b.h);
  const earliestBreach = withProjection.length ? withProjection[0].h : null;
  const earliestBreachName = withProjection.length ? withProjection[0].name : null;
  const newestMs = stations.reduce((acc, s) => (s.latest ? Math.max(acc, new Date(s.latest.observedAt).getTime()) : acc), 0);
  const oldestMs = stations.reduce((acc, s) => (s.latest ? Math.min(acc, new Date(s.latest.observedAt).getTime()) : acc), newestMs || Date.now());
  // Freshness as a count/fraction ("X/Y reporting <15m old") — a headline that
  // reads coherently on its own, not a "freshest" number Sittable against an
  // "oldest" caption that looks like a contradiction.
  const FRESH_MIN = 15;
  const freshCount = stations.filter((s) => {
    if (!s.latest) return false;
    return Date.now() - new Date(s.latest.observedAt).getTime() < FRESH_MIN * 60_000;
  }).length;
  return {
    active,
    activeRegions,
    earliestBreach,
    earliestBreachName,
    freshCount,
    newestObservedAt: newestMs ? new Date(newestMs).toISOString() : null,
    oldestObservedAt: oldestMs ? new Date(oldestMs).toISOString() : null,
  };
}

export function Dashboard() {
  const [stations, setStations] = useState<StationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [alertsCount, setAlertsCount] = useState(0);
  const [indiaFocus, setIndiaFocus] = useState(true);
  const stationsRef = useRef<StationDTO[]>([]);
  stationsRef.current = stations;

  useEffect(() => {
    get<{ stations: StationDTO[]; stats: NationalStats }>("/api/stations")
      .then((r) => {
        setStations(r.stations);
      })
      .catch((e) => console.error("load stations", e))
      .finally(() => setLoading(false));

    const unsub = subscribe<StationDTO>("station:update", (st) => {
      setStations((prev) => {
        const i = prev.findIndex((p) => p.id === st.id);
        if (i === -1) return [st, ...prev];
        const next = prev.slice();
        next[i] = st;
        return next;
      });
    });
    const unsubBoot = subscribe<{ stations: StationDTO[] }>("app:boot", (r) => {
      if (r?.stations?.length) setStations(r.stations);
    });
    subscribe("alert:new", () => setAlertsCount((c) => c + 1));
    return () => {
      unsub();
      unsubBoot();
    };
  }, []);

  const india = useMemo(() => stations.filter(isIndiaStation), [stations]);
  const external = useMemo(() => stations.filter((s) => !isIndiaStation(s)), [stations]);
  const stats = useMemo(() => computeStats(india), [india]);
  const ops = useMemo(() => operationalMetrics(india), [india]);
  const warnings = stats.byCategory.Warning + stats.byCategory.Severe + stats.byCategory.Critical;
  const index = stats.nationalIndex;
  const indexColor =
    index >= 70 ? "text-risk-critical" : index >= 50 ? "text-risk-severe" : index >= 28 ? "text-risk-warning" : "text-risk-normal";

  if (loading) {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center text-slate-500 mono">connecting to telemetry…</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* India-first headline stats */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="panel p-4 col-span-2 lg:col-span-2">
          <div className="panel-head">INDIA risk index</div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className={`mono text-4xl leading-none font-semibold ${indexColor}`}>{index}</span>
            <span className="text-slate-500 text-xs">/ 100</span>
            <div className="ml-auto text-right">
              <div className="text-[11px] text-slate-500 mono">{fmtDateTime(ops.newestObservedAt)}</div>
              <div className="text-[11px] text-slate-500">{stats.withReadings}/{stats.totalStations} Indian stations reporting</div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1 h-2 rounded-full bg-ink-800 overflow-hidden">
            {CATEGORY_ORDER.map((c) =>
              stats.byCategory[c] > 0 ? (
                <div
                  key={c}
                  className="h-full"
                  style={{ width: `${(stats.byCategory[c] / Math.max(1, stats.totalStations)) * 100}%`, background: CATEGORY_META[c].color }}
                  title={`${c}: ${stats.byCategory[c]}`}
                />
              ) : null
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {CATEGORY_ORDER.map((c) => (
              <span key={c} className="text-[11px] flex items-center gap-1.5 text-slate-400">
                <span className="w-2 h-2 rounded-full" style={{ background: CATEGORY_META[c].color }} />
                {c} <span className="mono text-slate-200">{stats.byCategory[c]}</span>
              </span>
            ))}
          </div>
        </div>

        {[
          { label: "stations monitored (INDIA)", value: stats.totalStations, color: "text-slate-100" },
          { label: "stations at warning+", value: warnings, color: warnings > 0 ? "text-risk-warning" : "text-slate-100" },
          {
            label: "stations reporting <15m old",
            value: `${ops.freshCount}/${stats.withReadings}`,
            color: "text-slate-100",
            sub: `freshest ${fmtRelative(ops.newestObservedAt)} · oldest ${fmtRelative(ops.oldestObservedAt)}`,
          },
          {
            label: "earliest danger est.",
            value: ops.earliestBreach != null ? fmtProjHours(ops.earliestBreach) : "—",
            color: ops.earliestBreach != null ? "text-red-300" : "text-slate-600",
            sub:
              ops.earliestBreach != null
                ? `${ops.earliestBreachName ?? "rising site"} · next rising site to cross danger`
                : "no rising site heading to danger",
          },
          {
            label: "active risk zones",
            value: ops.activeRegions.length || (ops.active.length ? ops.active.length : 0),
            color: ops.active.length ? "text-risk-warning" : "text-slate-100",
            sub: ops.activeRegions.length ? ops.activeRegions.join(", ") : "none at warning+",
          },
          { label: "alerts this session", value: alertsCount, color: "text-slate-100" },
        ].map((t) => (
          <div key={t.label} className="panel p-4">
            <div className="panel-head">{t.label}</div>
            <div className={`mt-2 mono text-3xl leading-none font-semibold ${t.color}`}>{t.value}</div>
            {"sub" in t && t.sub != null ? <div className="text-[11px] text-slate-500 mt-1 truncate">{t.sub}</div> : null}
          </div>
        ))}
      </div>

      {/* Map — India-first, with an all-sources reference toggle */}
      <div className="mt-4 panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-line">
          <h2 className="panel-head">{indiaFocus ? "INDIA telemetry map" : "telemetry map · all sources"}</h2>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 mono">live · websocket</span>
            <button
              onClick={() => setIndiaFocus((v) => !v)}
              className="px-2.5 py-1 rounded-md border border-line text-[11px] mono text-slate-400 hover:text-slate-200 transition-colors"
            >
              {indiaFocus ? "INDIA" : "ALL"}
            </button>
          </div>
        </div>
        <div className="h-80">
          <MapView stations={stations} indiaFocus={indiaFocus} />
        </div>
        {!indiaFocus && (
          <div className="px-4 py-2 border-t border-line text-[11px] text-slate-600">
            All sources shown — India stations (NWDP/demo) are scored and alert-enabled; UK EA / USGS gauges are
            live reference data only and never drive alerts or the national index.
          </div>
        )}
      </div>

      {/* LIVE EXTERNAL DATA (reference) */}
      {external.length > 0 && (
        <div className="mt-4 panel p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="panel-head">LIVE EXTERNAL DATA · reference</h2>
            <span className="text-[11px] text-slate-500">
              {external.filter((s) => s.latest).length}/{external.length} reporting · reference-only, excluded from the India risk index &amp; alert dispatch
            </span>
          </div>
          <ul className="mt-3 divide-y divide-line dim">
            {external
              .slice()
              .sort((a, b) => (b.latest?.riskScore ?? 0) - (a.latest?.riskScore ?? 0))
              .map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/station/${s.id}`}
                    className="flex items-center gap-3 px-1 py-2.5 hover:bg-ink-850 transition-colors rounded-md"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: CATEGORY_META[s.latest?.category ?? "No data"].color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-100 truncate">{s.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">{s.place} · {s.sourceLabel}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="mono text-xs text-slate-200">{fmtLevel(s.latest?.level, s.unit, s.levelBasis)}</div>
                      <div className="text-[10px] text-slate-500">{s.latest ? fmtRelative(s.latest.observedAt) : "no reading"}</div>
                    </div>
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* India station grid */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="panel-head">Stations · INDIA</h2>
        <span className="text-[11px] text-slate-500">click any station for detail · {india.length} monitored</span>
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {india.map((s) => (
          <StationCard key={s.id} station={s} />
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="panel-head">External reference stations</h2>
        <span className="text-[11px] text-slate-500">live · reference only</span>
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {external.map((s) => (
          <StationCard key={s.id} station={s} />
        ))}
      </div>

      <p className="mt-6 text-[11px] text-slate-600 leading-relaxed max-w-3xl">
        India gauges stream real CWC / state-department telemetry from the National Water Data Portal
        (nwdp.nwic.gov.in) as-published — hourly, and timestamped at acquisition, NOT re-dated as "now".
        Warning/danger thresholds for those gauges are inferred from their 2026 telemetry range (CWC does
        not publish HFL through this feed). Purple "simulated" stations are purely illustrative alert-demo
        data. Risk score = proximity·60 + rate-of-rise·30 + rain·10.
      </p>
    </div>
  );
}