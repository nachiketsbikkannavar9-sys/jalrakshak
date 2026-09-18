import type { RiskCategory } from "../../../shared/src/index.js";
import { CATEGORY_META } from "../lib/risk";

export function RiskBadge({ category, score, size = "md" }: { category: RiskCategory; score?: number | null; size?: "sm" | "md" }) {
  const meta = CATEGORY_META[category];
  return (
    <span
      className={`inline-flex items-center gap-1.5 border rounded-md font-mono ${meta.badge} ${
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"
      }`}
      title={`Risk category: ${category}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {category}
      {score != null && <span className="opacity-70">{score}</span>}
    </span>
  );
}