import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AlertDTO } from "../../../shared/src/index.js";
import { get, getToken, post } from "../lib/api";
import { subscribe } from "../lib/socket";
import { AlertFeed } from "../components/AlertFeed";
import { RiskBadge } from "../components/RiskBadge";
import { fmtDateTime, fmtProjHours, fmtRelative, fmtRise } from "../lib/format";

export function Alerts() {
  const [alerts, setAlerts] = useState<AlertDTO[]>([]);
  const [filter, setFilter] = useState<"all" | "sms" | "email">("all");
  const [isAuthority] = useState(() => !!getToken());

  useEffect(() => {
    get<{ alerts: AlertDTO[] }>("/api/alerts").then((r) => setAlerts(r.alerts)).catch(() => undefined);
    const u1 = subscribe<AlertDTO>("alert:new", (a) => setAlerts((p) => [a, ...p]));
    const u2 = subscribe<AlertDTO>("alert:acked", (a) =>
      setAlerts((p) => p.map((x) => (x.id === a.id ? a : x)))
    );
    return () => {
      u1();
      u2();
    };
  }, []);

  const visible = filter === "all" ? alerts : alerts.filter((a) => a.channel === filter);
  const unacked = alerts.filter((a) => !a.acknowledgedAt).length;

  const ack = async (id: string) => {
    try {
      const r = await post<{ alert: AlertDTO }>(`/api/alerts/${id}/acknowledge`);
      setAlerts((p) => p.map((x) => (x.id === id ? r.alert : x)));
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Alert feed</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            dispatch log · SMS + email · {unacked} unacknowledged
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {(["all", "sms", "email"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                filter === f ? "border-accent/60 text-accent bg-accent/10" : "border-line text-slate-500 hover:text-slate-300"
              }`}
            >
              {f === "all" ? "All channels" : f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 panel p-4">
        {visible.length === 0 ? (
          <AlertFeed alerts={[]} />
        ) : (
          <div>
            <ul className="divide-y divide-line dim">
              {visible.map((a) => (
                <li key={a.id} className="py-3">
                  <AlertFeedWrap alert={a} ack={ack} isAuthority={isAuthority} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function deliveryLabel(a: AlertDTO): string {
  switch (a.deliveryState) {
    case "delivered":
      return "delivered";
    case "logged-console":
      return `logged (console)${a.deliveredVia ? ` · ${a.deliveredVia}` : ""}`;
    default:
      return `provider rejected${a.deliveredVia ? ` · ${a.deliveredVia}` : ""}`;
  }
}

function AlertFeedWrap({ alert, ack, isAuthority }: { alert: AlertDTO; ack: (id: string) => void; isAuthority: boolean }) {
  const [showBody, setShowBody] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <RiskBadge category={alert.category} score={alert.riskScore} size="sm" />
      <span className={`chip border ${alert.channel === "sms" ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300" : "bg-amber-500/10 border-amber-500/30 text-amber-300"}`}>
        {alert.channel === "sms" ? "📱 SMS" : "✉️ EMAIL"}
      </span>
      <span className="text-xs text-slate-500 mono truncate max-w-[220px]">{alert.sentTo}</span>
      <span className="text-[11px] text-slate-500 mono">{deliveryLabel(alert)}</span>
      <span className="ml-auto text-[11px] text-slate-500 mono">{fmtDateTime(alert.createdAt)} · {fmtRelative(alert.createdAt)}</span>
      <div className="w-full">
        <Link to={`/station/${alert.stationId}`} className="text-sm text-slate-100 hover:text-accent font-medium">
          {alert.stationName}
        </Link>
        <span className="text-xs text-slate-500"> · {alert.place}</span>
        <button onClick={() => setShowBody((v) => !v)} className="ml-3 text-[11px] text-slate-500 hover:text-accent mono">
          {showBody ? "hide message" : "view message"}
        </button>
        {alert.level != null && alert.normalLevel != null && alert.warningLevel != null && alert.dangerLevel != null && (
          <div className="mt-1 text-[11px] mono text-slate-500">
            at alert: level <span className="text-slate-300">{alert.level.toFixed(2)} {alert.unit ?? "m"}</span> · warning{" "}
            {alert.warningLevel.toFixed(2)} · danger {alert.dangerLevel.toFixed(2)} {alert.unit ?? "m"}
            {alert.rateOfRise != null && <> · rise {fmtRise(alert.rateOfRise)}</>}
            {alert.projectionHoursToDanger != null && (
              <span className="text-red-300">
                {" "}· est. danger in {fmtProjHours(alert.projectionHoursToDanger)}
              </span>
            )}
          </div>
        )}
      </div>
      {showBody && (
        <pre className="w-full text-[11px] text-slate-400 bg-ink-850 border border-line rounded-md p-3 mono whitespace-pre-wrap leading-relaxed mt-1">
          {alert.body}
        </pre>
      )}
      {alert.acknowledgedAt ? (
        <span className="text-xs text-emerald-400">✓ acknowledged by {alert.acknowledgedBy} · {fmtRelative(alert.acknowledgedAt)}</span>
      ) : isAuthority ? (
        <button onClick={() => ack(alert.id)} className="text-xs font-semibold px-3 py-1 rounded-md border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10">
          ✓ acknowledge
        </button>
      ) : (
        <span className="text-xs text-amber-400/80">awaiting acknowledgement</span>
      )}
    </div>
  );
}