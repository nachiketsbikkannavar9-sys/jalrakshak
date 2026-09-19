import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import type { LatLng } from "leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useNavigate } from "react-router-dom";
import type { StationDTO } from "../../../shared/src/index.js";
import { CATEGORY_META } from "../lib/risk";
import { fmtLevel, fmtProjHours, fmtRelative } from "../lib/format";
import type { LocationExposureResponse } from "../lib/exposure";
import { RiskBadge } from "./RiskBadge";

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
    <Marker
      position={[station.lat, station.lng]}
      icon={icon}
      bubblingMouseEvents={false}
      eventHandlers={{
        click: (e) => {
          L.DomEvent.stopPropagation(e.originalEvent);
        },
      }}
    >
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

export interface UserPoint {
  lat: number;
  lng: number;
  label: string;
}

const userIcon = L.divIcon({
  className: "jrk-user-marker-wrap",
  html: `<div class="jrk-user-dot"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -12],
});

function UserMarker({ point, exposure }: { point: UserPoint; exposure?: LocationExposureResponse | null }) {
  const station = exposure?.nearestStation ?? null;
  return (
    <Marker position={[point.lat, point.lng]} icon={userIcon}>
      <Popup>
        <div className="text-[12px] leading-relaxed">
          <div className="font-semibold text-sky-300">{point.label}</div>
          <div className="mono text-slate-400">{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</div>
          {exposure ? (
            <>
              <div className="mt-1 text-slate-300">
                Elevation:{" "}
                <span className="mono text-slate-200">
                  {exposure.elevation.elevationM != null ? `${exposure.elevation.elevationM.toFixed(1)} m` : "unavailable"}
                </span>
              </div>
              <div className="text-slate-300">
                Closest gauge: <span className="text-slate-100">{station ? station.name : "none"}</span>
                {exposure.distanceKm != null && <span className="mono text-slate-500"> · {exposure.distanceKm.toFixed(1)} km</span>}
              </div>
              {station && (
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-slate-500">Station hazard:</span>
                  <RiskBadge category={station.hazardCategory ?? "No data"} score={station.latest?.riskScore} size="sm" />
                </div>
              )}
              <div className="mt-1 flex items-center gap-2">
                <span className="text-slate-500">Personal exposure:</span>
                <RiskBadge category={exposure.exposure.category} score={exposure.exposure.score} size="sm" />
              </div>
              <div className="mt-1 text-[10px] text-slate-600">
                Estimated personal exposure — modelled, not a guarantee. Station popups are unchanged.
              </div>
            </>
          ) : (
            <div className="text-slate-500 text-[11px]">Evaluating this point for personal flood exposure…</div>
          )}
        </div>
      </Popup>
    </Marker>
  );
}

function ClickCatcher({ onPick }: { onPick?: (latlng: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onPick?.(e.latlng);
    },
  });
  return null;
}

export function MapView({
  stations,
  indiaFocus = true,
  userLocation = null,
  userExposure = null,
  onMapPick,
}: {
  stations: StationDTO[];
  indiaFocus?: boolean;
  userLocation?: UserPoint | null;
  userExposure?: LocationExposureResponse | null;
  onMapPick?: (latlng: LatLng) => void;
}) {
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
      <ClickCatcher onPick={onMapPick} />
      <FitBounds stations={shown} indiaFocus={indiaFocus} />
      {shown.map((s) => (
        <StationMarker key={s.id} station={s} />
      ))}
      {userLocation && <UserMarker point={userLocation} exposure={userExposure} />}
    </MapContainer>
  );
}