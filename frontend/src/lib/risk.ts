import type { RiskCategory } from "../../../shared/src/index.js";
import { CATEGORY_GUIDANCE } from "../../../shared/src/index.js";

export const CATEGORY_ORDER: RiskCategory[] = ["Normal", "Watch", "Warning", "Severe", "Critical"];

export const CATEGORY_META: Record<
  RiskCategory,
  { color: string; badge: string; edge: string; marker: string; text: string; dot: string }
> = {
  Normal: {
    color: "#34d399",
    badge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    edge: "bg-[#34d399]",
    marker: "bg-[#34d399]",
    text: "text-emerald-300",
    dot: "bg-emerald-400",
  },
  Watch: {
    color: "#fbbf24",
    badge: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    edge: "bg-[#fbbf24]",
    marker: "bg-[#fbbf24]",
    text: "text-amber-300",
    dot: "bg-amber-400",
  },
  Warning: {
    color: "#fb923c",
    badge: "bg-orange-500/10 text-orange-300 border-orange-500/30",
    edge: "bg-[#fb923c]",
    marker: "bg-[#fb923c]",
    text: "text-orange-300",
    dot: "bg-orange-400",
  },
  Severe: {
    color: "#f87171",
    badge: "bg-red-500/10 text-red-300 border-red-500/30",
    edge: "bg-[#f87171]",
    marker: "bg-[#f87171]",
    text: "text-red-300",
    dot: "bg-red-400",
  },
  Critical: {
    color: "#e879f9",
    badge: "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30",
    edge: "bg-[#e879f9]",
    marker: "bg-[#e879f9]",
    text: "text-fuchsia-300",
    dot: "bg-fuchsia-400",
  },
  "No data": {
    color: "#94a3b8",
    badge: "bg-slate-500/10 text-slate-400 border-slate-500/40",
    edge: "bg-[#94a3b8]",
    marker: "bg-[#94a3b8]",
    text: "text-slate-400",
    dot: "bg-slate-500",
  },
};

export function categoryOf(score: number): RiskCategory {
  if (score >= 88) return "Critical";
  if (score >= 70) return "Severe";
  if (score >= 50) return "Warning";
  if (score >= 28) return "Watch";
  return "Normal";
}

/** Plain-language, citizen-facing action per category (public view + email alerts). */
export const PUBLIC_GUIDANCE = CATEGORY_GUIDANCE;