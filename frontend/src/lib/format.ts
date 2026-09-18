export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

export function fmtLevel(v: number | null | undefined, unit = "m", basis?: "RL" | "Depth" | null): string {
  if (v == null) return "—";
  return `${v.toFixed(2)} ${unit}${basis === "RL" ? " (RL · above MSL)" : ""}`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

const MAX_ABS_RATE_H = 12; // mirror of shared MAX_ABS_RATE_H — belt-and-braces guard
export function fmtRise(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate) || Math.abs(rate) > MAX_ABS_RATE_H) return "—";
  return `${rate >= 0 ? "+" : "−"}${Math.abs(rate).toFixed(3)} m/h`;
}

/** Compact "time to threshold", e.g. "3h 20m" | "45m" | "12h". */
export function fmtProjHours(hours: number): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  if (hours < 0.05) return "<1m";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 60) return `${h + 1}h`;
  return m >= 10 ? `${h}h ${m}m` : `${h}h ${String(m).padStart(2, "0")}m`;
}