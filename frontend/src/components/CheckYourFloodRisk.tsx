import { useEffect, useState } from "react";
import { MAX_LOCAL_GAUGE_KM, type StationDTO } from "../../../shared/src/index.js";
import { CATEGORY_META } from "../lib/risk";
import { getDemoPair, getLocationExposure, type DemoPair, type LocationExposureResponse } from "../lib/exposure";
import { fmtLevel, fmtRelative } from "../lib/format";
import { RiskBadge } from "./RiskBadge";

export interface RiskPoint {
  lat: number;
  lng: number;
  label: string;
}

export function CheckYourFloodRisk({
  stations,
  point,
  onPointChange,
  onResult,
}: {
  stations: StationDTO[];
  point: RiskPoint | null;
  onPointChange: (point: RiskPoint) => void;
  onResult?: (result: LocationExposureResponse | null) => void;
}) {
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LocationExposureResponse | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoPair | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  // Demo presets come from the server: a low-ground/raised-ground pair near the
  // same gauge whose exposures are evaluated live so they land in different
  // risk bands where terrain allows it.
  useEffect(() => {
    if (stations.length === 0) return;
    let live = true;
    setDemoBusy(true);
    setDemoError(null);
    getDemoPair()
      .then((d) => {
        if (live) setDemo(d);
      })
      .catch((e: unknown) => {
        if (live) setDemoError(e instanceof Error ? e.message : "Demo presets are unavailable right now — use coordinates instead.");
      })
      .finally(() => {
        if (live) setDemoBusy(false);
      });
    return () => {
      live = false;
    };
  }, [stations]);

  // Debounced manual coordinate lookup — pauses 600 ms after typing stops.
  useEffect(() => {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    const valid = manualLat.trim() !== "" && manualLng.trim() !== "" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    if (!valid) return;
    const t = setTimeout(() => {
      onPointChange({ lat, lng, label: "Manual coordinates" });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualLat, manualLng]);

  // Fetch personal exposure whenever a point is chosen (by any means).
  useEffect(() => {
    if (!point) {
      setResult(null);
      setError(null);
      onResult?.(null);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    getLocationExposure(point.lat, point.lng)
      .then((r) => {
        if (live) {
          setResult(r);
          onResult?.(r);
        }
      })
      .catch((e: unknown) => {
        if (live) {
          setError(e instanceof Error ? e.message : "Failed to evaluate this location");
          onResult?.(null);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [point]);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoError("Geolocation isn't available in this browser — enter coordinates manually or try a demo preset.");
      return;
    }
    setGeoBusy(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onPointChange({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: "My location" });
        setGeoBusy(false);
      },
      (err) => {
        setGeoError(err.code === err.PERMISSION_DENIED ? "Location permission denied — enter coordinates manually or try a demo preset." : "Could not read your location — enter coordinates manually or try a demo preset.");
        setGeoBusy(false);
      },
      { timeout: 12_000, maximumAge: 60_000 }
    );
  };

  const pickDemoLow = () => {
    if (!demo) return;
    setManualLat("");
    setManualLng("");
    onPointChange({ lat: demo.low.lat, lng: demo.low.lng, label: demo.low.label });
  };
  const pickDemoRaised = () => {
    if (!demo) return;
    setManualLat("");
    setManualLng("");
    onPointChange({ lat: demo.raised.lat, lng: demo.raised.lng, label: demo.raised.label });
  };

  const exp = result?.exposure;
  const meta = exp ? CATEGORY_META[exp.category] : null;
  const hazardMeta = result?.nearestStation?.latest;

  return (
    <div>
      <p className="text-[12px] text-slate-500 max-w-3xl leading-relaxed">
        A point on the ground has its own <span className="text-slate-300">personal exposure</span> — how at-risk that
        specific spot is, not just how the nearest gauge is doing. It combines the gauge hazard with the point's
        elevation relative to the current water level, distance from the river, rise rate, rainfall and (where known)
        flood-zones. Estimated and modelled — never a guarantee.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={useMyLocation}
          disabled={geoBusy}
          className="rounded-md bg-accent text-ink-950 text-sm font-semibold px-3 py-2 disabled:opacity-60"
        >
          {geoBusy ? "Locating…" : "Use my location"}
        </button>

        <div className="flex items-center gap-1.5">
          <input
            value={manualLat}
            onChange={(e) => setManualLat(e.target.value)}
            placeholder="lat e.g. 20.4625"
            inputMode="decimal"
            aria-label="Latitude"
            className="w-32 bg-ink-850 border border-line rounded-md px-2 py-2 text-xs text-slate-200 focus:outline-none focus:border-accent/60"
          />
          <input
            value={manualLng}
            onChange={(e) => setManualLng(e.target.value)}
            placeholder="lng e.g. 85.8570"
            inputMode="decimal"
            aria-label="Longitude"
            className="w-32 bg-ink-850 border border-line rounded-md px-2 py-2 text-xs text-slate-200 focus:outline-none focus:border-accent/60"
          />
          <span className="text-[11px] text-slate-600">looks up as you type</span>
        </div>

        {demo ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-600">Demo:</span>
            <button onClick={pickDemoLow} className="rounded-md border border-sky-500/40 text-sky-300 text-xs px-2.5 py-2 hover:bg-sky-500/10">
              Low ground by river
            </button>
            <button onClick={pickDemoRaised} className="rounded-md border border-amber-500/40 text-amber-300 text-xs px-2.5 py-2 hover:bg-amber-500/10">
              Raised ground further out
            </button>
            <span className="text-[10px] text-slate-600">
              (same gauge: {demo.station.name} · {demo.low.category} vs {demo.raised.category})
            </span>
            {!demo.crossedBands && (
              <span className="text-[10px] text-orange-300"> · terrain limits the contrast here</span>
            )}
          </div>
        ) : demoBusy ? (
          <span className="text-[11px] text-slate-600">loading demo presets…</span>
        ) : demoError ? (
          <span className="text-[11px] text-orange-300">{demoError}</span>
        ) : null}
      </div>

      {geoError && <p className="mt-2 text-[12px] text-orange-300">{geoError}</p>}

      {loading && <p className="mt-3 text-[12px] text-slate-500 mono">evaluating this point (elevation lookup)…</p>}
      {error && <p className="mt-3 text-[12px] text-red-300">{error}</p>}

      {result && exp && meta && !loading && (
        <div className="mt-4 panel border overflow-hidden">
          <div className="px-4 py-3 flex flex-wrap items-center gap-3">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">Personal exposure · {point?.label ?? "chosen point"}</span>
            <span className="mono text-[10px] text-slate-600">
              {point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : ""}
            </span>
            <span className="ml-auto mono text-[10px] text-slate-600">MODELLED / SIMULATED · {fmtRelative(result.fetchedAt)}</span>
          </div>
          <div className={`h-1 ${meta.edge}`} />
          <div className="px-4 py-4">
            <div className="flex items-center gap-4">
              <div className="shrink-0">
                <div className="text-4xl font-semibold mono" style={{ color: meta.color }}>
                  {exp.score}
                  <span className="text-sm text-slate-500">/100</span>
                </div>
                <div className={`inline-flex items-center gap-1.5 mt-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${meta.badge}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                  PERSONAL EXPOSURE · {exp.category}
                </div>
                {exp.noNearbyGauge && (
                  <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-slate-500/40 bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                    no nearby gauge · low confidence
                  </div>
                )}
                {!exp.noNearbyGauge && result && !result.elevation.available && (
                  <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-slate-500/40 bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                    elevation unavailable · reduced confidence
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1 text-[12px] leading-relaxed">
                {result.nearestStation ? (
                  <>
                    <div className="text-slate-300">
                      Closest gauge: <span className="font-semibold">{result.nearestStation.name}</span> · {result.nearestStation.place}
                      {result.nearestStation.region ? ` · ${result.nearestStation.region}` : ""}{" "}
                      <span className="mono text-slate-500">({result.distanceKm != null ? `${result.distanceKm.toFixed(1)} km away` : "distance unknown"})</span>
                      {exp.noNearbyGauge && (
                        <span className="text-[10px] text-slate-600"> · beyond the {MAX_LOCAL_GAUGE_KM} km local range</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span className="text-slate-400">Gauge hazard (separate scale):</span>
                      <RiskBadge
                        category={hazardMeta?.category ?? "No data"}
                        score={hazardMeta?.riskScore}
                        size="sm"
                      />
                      {hazardMeta && (
                        <span className="text-slate-500">
                          level {fmtLevel(hazardMeta.level, result.nearestStation.unit, result.nearestStation.levelBasis)} · last {fmtRelative(hazardMeta.observedAt)}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-slate-400">No monitored gauge near this point — the exposure below is a neutral estimate.</div>
                )}
                {result.elevation.available && result.elevation.elevationM != null ? (
                  <div className="mt-1 text-slate-500">
                    ground elevation ~{result.elevation.elevationM.toFixed(1)} m
                    {result.explanation.elevationGaugeRelative ? " (compared in the gauge's reference — not survey-grade)" : ""}
                  </div>
                ) : (
                  <div className="mt-1 text-slate-500">
                    Elevation data temporarily unavailable — the elevation component was excluded; the estimate has reduced confidence.
                  </div>
                )}
                {!exp.available && (
                  <div className="mt-1 text-orange-300 font-semibold">No local signal drove this score — it is a neutral baseline.</div>
                )}
              </div>
            </div>

            <div className={`mt-4 rounded-md border px-3 py-2 text-[12px] leading-relaxed ${
              result.advice.level === "warning"
                ? "border-red-500/40 text-red-200 bg-red-500/5"
                : result.advice.level === "advisory"
                  ? "border-amber-500/40 text-amber-200 bg-amber-500/5"
                  : "border-line text-slate-400"
            }`}>
              <span className="font-semibold uppercase text-[10px] tracking-wide">
                {result.advice.level === "warning" ? "Location warning" : result.advice.level === "advisory" ? "Location advisory" : "Location status"}
              </span>
              <div className="mt-0.5">{result.advice.message}</div>
            </div>

            <p className="mt-3 text-[12px] text-slate-400 leading-relaxed">{result.explanation.whyThisExposure}</p>

            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">
                How is this computed? ({result.explanation.factors.length} signals)
              </summary>
              <ul className="mt-2 divide-y divide-line dim rounded-md border border-line text-[12px]">
                {result.explanation.factors.map((f) => {
                  const fm = CATEGORY_META[f.band];
                  return (
                    <li key={f.key} className="flex items-center gap-2 px-3 py-2">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${fm.dot}`} />
                      <span className="min-w-0 flex-1 text-slate-300 truncate" title={f.label}>{f.label}</span>
                      <span className="mono text-[10px] text-slate-500">{f.criteria}</span>
                      <span className="mono text-[11px] w-14 text-right" style={{ color: fm.color }}>
                        {f.score} · {f.band}
                      </span>
                      <span className="mono text-[10px] text-slate-600 w-8 text-right">{f.weight}%</span>
                    </li>
                  );
                })}
              </ul>
            </details>

            <p className="mt-3 text-[10px] text-slate-600 leading-relaxed">{result.explanation.honesty}</p>
          </div>
        </div>
      )}
    </div>
  );
}