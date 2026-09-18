import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useNavigate } from "react-router-dom";
import type { StationDTO } from "../../../shared/src/index.js";
import { CATEGORY_META } from "../lib/risk";
import { fmtLevel, fmtProjHours, fmtRelative } from "../lib/format";

export const INDIA_SOURCES = ["nwdp", "demo", "seed", "wris"];

export function isIndiaStation(s: StationDTO): boolean {
  return !["ukEA", "usgs"].includes(s.source) || (!!s.region && s.region !== "United Kingdom" && s.region !== "United States");
}

/** India's extent — used to reason about India-focus framing. */
export const INDIA_BOUNDS: [[number, number], [number, number]] = [
  [6.5, 68],
  [37.5, 97.5],
];

function FitBounds({ stations, indiaFocus }: { stations: StationDTO[]; indiaFocus: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (indiaFocus) {
      // Deterministic India focus: fixed centre near [22, 79] at zoom 5 so the
      // default view is India filling the frame — never a broad
      // Middle-East-to-Philippines fit (which a wide, short map pane would
      // otherwise force). "ALL" mode below still fits the full station set.
      map.setView([22, 79], 5, { animate: false });
      return;
    }
    const pts = stations.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
    if (!pts.length) return;
    const bounds = L.latLngBounds(pts.map((s) => [s.lat, s.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 9 });
  }, [stations, map, indiaFocus]);
  return null;
}

function StationMarker({ station }: { station: StationDTO }) {
  const nav = useNavigate();
  const cat = station.latest?.category ?? "No data";
  const meta = CATEGORY_META[cat];
  const pulse = cat === "Severe" || cat === "Critical";
  const p = station.latest?.projection;
  const dangerIn = p?.hoursToDanger;
  const icon = useMemo(
    () =>
      L.divIcon({
        className: "jrk-marker-wrap",
        html: `<div class="jrk-marker ${pulse ? "pulse" : ""}" style="position:relative;color:${meta.color};background:${meta.color}"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        popupAnchor: [0, -10],
      }),
    [meta.color, pulse]
  );
  return (
    <Marker position={[station.lat, station.lng]} icon={icon}>
      <Popup>
        <div className="text-[12px] leading-relaxed">
          <div className="font-semibold text-slate-800">{station.name}</div>
          <div className="text-slate-500 text-[11px]">{station.place}{station.region ? ` · ${station.region}` : ""}</div>
          <div className="mono mt-1">
            <span style={{ color: meta.color }}>{cat}</span> · {station.latest?.riskScore ?? "—"}/100
          </div>
          <div className="mono text-slate-700">{fmtLevel(station.latest?.level, station.unit, station.levelBasis)}</div>
          <div className="text-slate-500 text-[11px] mono mt-0.5">
            warning {fmtLevel(station.warningLevel, station.unit)} · danger {fmtLevel(station.dangerLevel, station.unit)}
          </div>
          {dangerIn != null && (
            <div className="text-red-600 text-[11px] mono mt-0.5">est. danger in {fmtProjHours(dangerIn)}</div>
          )}
          <div className="text-slate-500 mt-0.5">{station.latest && fmtRelative(station.latest.observedAt)} · {station.sourceLabel}</div>
          <button
            onClick={() => nav(`/station/${station.id}`)}
            className="mt-2 rounded bg-accent text-ink-950 text-[11px] font-semibold px-2 py-1"
          >
            Open station →
          </button>
        </div>
      </Popup>
    </Marker>
  );
}

export function MapView({ stations, indiaFocus = true }: { stations: StationDTO[]; indiaFocus?: boolean }) {
  const shown = indiaFocus ? stations.filter(isIndiaStation) : stations;
  const center: [number, number] = indiaFocus ? [22, 79] : [22, 80];
  return (
    <MapContainer
      center={center}
      zoom={indiaFocus ? 5 : 4}
      scrollWheelZoom={true}
      className="w-full h-full"
      attributionControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds stations={shown} indiaFocus={indiaFocus} />
      {shown.map((s) => (
        <StationMarker key={s.id} station={s} />
      ))}
    </MapContainer>
  );
}