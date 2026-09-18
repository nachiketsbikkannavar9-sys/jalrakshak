import { Link } from "react-router-dom";
import type { AlertDTO } from "../../../shared/src/index.js";
import { CATEGORY_META } from "../lib/risk";
import { fmtRelative } from "../lib/format";
import { RiskBadge } from "./RiskBadge";

export function AlertFeed({ alerts, compact = false }: { alerts: AlertDTO[]; compact?: boolean }) {
  if (!alerts.length) {
    return (
      <div className="text-slate-500 text-sm py-6 text-center mono">
        <span className="block text-lg mb-1">🛰️</span>
        no alerts sent yet — stations below warning thresholds
      </div>
    );
  }
  const list = compact ? alerts.slice(0, 5) : alerts;
  return (
    <ul className="divide-y divide-line dim">
      {list.map((a) => {
        const meta = CATEGORY_META[a.category];
        return (
          <li key={a.id} className="py-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
              <RiskBadge category={a.category} score={a.riskScore} size="sm" />
              <span className="text-[10px] uppercase tracking-wider mono text-slate-500">
                {a.channel === "sms" ? "SMS" : "EMAIL"} → {a.sentTo}
              </span>
              <span className="ml-auto text-[11px] text-slate-500 mono">{fmtRelative(a.createdAt)}</span>
            </div>
            <div className="mt-1 text-sm">
              <Link to={`/station/${a.stationId}`} className="text-slate-100 hover:text-accent">
                {a.stationName}
              </Link>
              <span className="text-slate-500"> · {a.place}</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {a.acknowledgedAt ? (
                <span className="text-emerald-400">
                  ✓ acknowledged by {a.acknowledgedBy} · {fmtRelative(a.acknowledgedAt)}
                </span>
              ) : (
                <span className="text-amber-400/80">awaiting acknowledgement</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}