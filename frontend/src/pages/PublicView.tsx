import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { RiskCategory, StationDTO } from "../../../shared/src/index.js";
import { get, post } from "../lib/api";
import { CATEGORY_ORDER, CATEGORY_META, PUBLIC_GUIDANCE } from "../lib/risk";
import { fmtLevel, fmtRelative } from "../lib/format";
import { MapView, type UserPoint } from "../components/MapView";
import { RiskBadge } from "../components/RiskBadge";
import { SubscribePanel } from "../components/SubscribePanel";
import { CheckYourFloodRisk } from "../components/CheckYourFloodRisk";
import type { LocationExposureResponse } from "../lib/exposure";

const ALL_CATEGORIES: RiskCategory[] = [...CATEGORY_ORDER, "No data"];

/** Item 7: no-login "is my area at risk?" — pick a state, we filter your rivers. */
function CheckYourArea({ stations }: { stations: StationDTO[] }) {
  const [region, setRegion] = useState("");
  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const s of stations) {
      if (s.region && !["United Kingdom", "United States"].includes(s.region)) set.add(s.region);
    }
    return [...set].sort();
  }, [stations]);

  const mine = region ? stations.filter((s) => s.region === region) : [];
  const mineWarn = mine.filter((s) => ["Warning", "Severe", "Critical"].includes(s.latest?.category ?? "Normal"));
  return (
    <div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="text-[12px] text-slate-400">Your state / area:</label>
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="bg-ink-850 border border-line rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-accent/60"
        >
          <option value="">— select a state —</option>
          {regions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {region && (
        <div className="mt-3">
          {mine.length === 0 ? (
            <p className="text-[12px] text-slate-500">No monitored gauges listed for {region} yet — rely on district advisories.</p>
          ) : (
            <>
              {mineWarn.length > 0 ? (
                <p className="text-[12px] text-orange-300 font-semibold">
                  ⚠ {mineWarn.length} gauge{mineWarn.length === 1 ? "" : "s"} in {region} at warning or above — see guidance below.
                </p>
              ) : (
                <p className="text-[12px] text-emerald-300 font-semibold">
                  ✓ monitored gauges in {region} are at normal/watch right now — stay alert during heavy rain.
                </p>
              )}
              <ul className="mt-2 divide-y divide-line dim rounded-md border border-line">
                {mine.map((s) => (
                  <li key={s.id}>
                    <Link to={`/station/${s.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-ink-850 transition-colors">
                      <RiskBadge category={s.latest?.category ?? "No data"} score={s.latest?.riskScore} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-slate-100 truncate">{s.name}</div>
                        <div className="text-[11px] text-slate-500 truncate">{s.place}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="mono text-xs text-slate-200">
                          {s.latest ? fmtLevel(s.latest.level, s.unit, s.levelBasis) : "no reading"}
                        </div>
                        <div className="text-[10px] text-slate-500">{s.latest ? fmtRelative(s.latest.observedAt) : "—"}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function PublicView() {
  const [stations, setStations] = useState<StationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [userPoint, setUserPoint] = useState<UserPoint | null>(null);
  const [userExposure, setUserExposure] = useState<LocationExposureResponse | null>(null);

  const pickUserPoint = (p: UserPoint) => {
    setUserExposure(null); // a new point invalidates the previous evaluation
    setUserPoint(p);
  };

  useEffect(() => {
    get<{ stations: StationDTO[] }>("/api/stations")
      .then((r) => setStations(r.stations))
      .catch((e) => console.error("load stations", e))
      .finally(() => setLoading(false));
  }, []);

  const byCategory = useMemo(() => {
    const m = new Map<RiskCategory, StationDTO[]>();
    for (const c of ALL_CATEGORIES) m.set(c, []);
    for (const s of stations) {
      const c = (s.latest?.category ?? "No data") as RiskCategory;
      m.get(c)?.push(s);
    }
    return m;
  }, [stations]);

  const active = ALL_CATEGORIES.filter((c) => c !== "Normal" && c !== "No data" && (byCategory.get(c)?.length ?? 0) > 0).map(
    (c) => byCategory.get(c)!
  ).flat().length;

  if (loading) {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center text-slate-500 mono">loading river situation…</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Hero */}
      <div className="panel overflow-hidden">
        <div className="px-5 py-6 text-center">
          <h1 className="text-2xl font-semibold text-white">River status for your district</h1>
          <p className="mt-2 text-sm text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Public, read-only view of monitored rivers. Each station is coloured by a server-computed risk
            score: <span className="text-emerald-300">normal</span>, <span className="text-amber-300">watch</span>,{" "}
            <span className="text-orange-300">warning</span>, <span className="text-red-300">severe</span> or{" "}
            <span className="text-fuchsia-300">critical</span>. Grey means the gauge has not reported recently.
          </p>
          {active > 0 ? (
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-orange-500/40 bg-orange-500/10 text-orange-300 text-xs font-semibold">
              ● {active} river site{active === 1 ? "" : "s"} at warning or above — check the guidance below
            </div>
          ) : (
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-xs font-semibold">
              ● no monitored sites at warning right now
            </div>
          )}
        </div>
        <div className="h-80 border-t border-line">
          <MapView
            stations={stations}
            userLocation={userPoint}
            userExposure={userExposure}
            onMapPick={(latlng) => pickUserPoint({ lat: latlng.lat, lng: latlng.lng, label: "Pin on map" })}
          />
        </div>
      </div>

      {/* Check your flood risk — personal, location-level exposure (no login) */}
      <div className="mt-6 panel p-4">
        <h2 className="panel-head">CHECK YOUR FLOOD RISK — PERSONAL EXPOSURE</h2>
        <CheckYourFloodRisk stations={stations} point={userPoint} onPointChange={pickUserPoint} onResult={setUserExposure} />
      </div>

      {/* Check your area — pick a state, see only your rivers (no login) */}
      <div className="mt-6 panel p-4">
        <h2 className="panel-head">CHECK YOUR AREA</h2>
        <CheckYourArea stations={stations} />
      </div>

      {/* What the colours mean */}
      <div className="mt-6">
        <h2 className="panel-head">What the colours mean &amp; what to do</h2>
        <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ALL_CATEGORIES.map((c) => {
            const g = PUBLIC_GUIDANCE[c];
            const meta = CATEGORY_META[c];
            const count = byCategory.get(c)?.length ?? 0;
            return (
              <div key={c} className="panel p-4">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${meta.dot}`} />
                  <span className={`text-sm font-semibold ${meta.text}`}>{g.title}</span>
                  <span className="ml-auto mono text-[11px] text-slate-500">{count} site{count === 1 ? "" : "s"}</span>
                </div>
                <p className="mt-2 text-[12px] text-slate-400 leading-relaxed">{g.action}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Subscribe (no login) */}
      <div className="mt-6">
        <SubscribePanel stations={stations} />
      </div>

      {/* Station list */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="panel-head">Stations</h2>
        <span className="text-[11px] text-slate-500">data as published by the sources · never re-dated</span>
      </div>
      <div className="mt-3 panel overflow-hidden">
        <ul className="divide-y divide-line dim">
          {stations.map((s) => {
            const cat = s.latest?.category ?? "No data";
            return (
              <li key={s.id}>
                <Link to={`/station/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-ink-850 transition-colors">
                  <RiskBadge category={cat} score={s.latest?.riskScore} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-100 truncate">{s.name}</div>
                    <div className="text-[11px] text-slate-500 truncate">{s.place}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="mono text-xs text-slate-200">{s.latest ? fmtLevel(s.latest.level, s.unit, s.levelBasis) : "—"}</div>
                    <div className="text-[10px] text-slate-500">{s.latest ? fmtRelative(s.latest.observedAt) : "no reading yet"}</div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="mt-5 text-[11px] text-slate-600 leading-relaxed max-w-3xl">
        This is a hackathon demo. Category colours come from Jalrakshak's server-side risk formula
        (proximity to danger · 60 + rate-of-rise · 30 + rain · 10). Personal exposure (Normal → Critical, the same
        category scale) is a separate,
        location-level estimate ("how at-risk is THIS point") — modelled, not a guarantee; it never overrides the
        station hazard, which governs all official alerts. Alerts shown to authorities are separate; citizens should
        always follow official district/NDRF announcements. India gauges stream real CWC / state-department
        telemetry via NWDP, as-published, with true acquisition timestamps.
      </p>
    </div>
  );
}