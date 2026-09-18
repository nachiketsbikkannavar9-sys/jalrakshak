import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AlertDTO, ContactDTO, StationDTO } from "../../../shared/src/index.js";
import { isNationalScope, scopeLabel, stationInScope } from "../../../shared/src/index.js";
import { get, getAuthUser, post, setAuthUser, setToken } from "../lib/api";
import { subscribe } from "../lib/socket";
import { RiskBadge } from "../components/RiskBadge";
import { fmtDateTime, fmtRelative } from "../lib/format";

export function AuthorityConsole() {
  const nav = useNavigate();
  const user = getAuthUser();
  const [alerts, setAlerts] = useState<AlertDTO[]>([]);
  const [contacts, setContacts] = useState<ContactDTO[]>([]);
  const [stations, setStations] = useState<StationDTO[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      nav("/auth/login");
      return;
    }
    get<{ alerts: AlertDTO[] }>("/api/alerts").then((r) => setAlerts(r.alerts)).catch((e) => setError((e as Error).message));
    get<{ contacts: ContactDTO[] }>("/api/alerts/contacts").then((r) => setContacts(r.contacts)).catch(() => undefined);
    get<{ stations: StationDTO[]; stats: unknown }>("/api/stations").then((r) => setStations(r.stations)).catch(() => undefined);
    const u1 = subscribe<AlertDTO>("alert:new", (a) => setAlerts((p) => [a, ...p]));
    const u2 = subscribe<AlertDTO>("alert:acked", (a) => setAlerts((p) => p.map((x) => (x.id === a.id ? a : x))));
    return () => {
      u1();
      u2();
    };
  }, [user, nav]);

  const national = isNationalScope(user);
  const inScope = (s: StationDTO) => stationInScope(user, s);
  const scoped = (a: AlertDTO) => stationInScope(user, { id: a.stationId, region: undefined });
  const scopedAlerts = useMemo(() => alerts.filter(scoped), [alerts, national]);
  const unacked = useMemo(() => scopedAlerts.filter((a) => !a.acknowledgedAt), [scopedAlerts]);
  const simStations = useMemo(() => stations.filter((s) => s.simulated && inScope(s)), [stations, national]);

  const ack = async (id: string) => {
    setBusyId(id);
    try {
      const r = await post<{ alert: AlertDTO }>(`/api/alerts/${id}/acknowledge`);
      setAlerts((p) => p.map((x) => (x.id === id ? r.alert : x)));
      setMessage(`Alert ${id.slice(-6)} acknowledged by ${r.alert.acknowledgedBy} — recorded server-side.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const triggerSpike = async (stationId: string) => {
    setBusyId(`spike:${stationId}`);
    setError(null);
    setMessage(null);
    try {
      const r = await post<{ alerts: number; stationId: string }>("/api/admin/simulate", {
        stationId,
        mode: "past-warning",
      });
      const st = stations.find((s) => s.id === r.stationId);
      setMessage(
        `Simulated station "${st?.name ?? stationId}" pushed past its warning threshold → ${r.alerts} alert(s) dispatched to the demo list.`
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const triggerTrend = async (stationId: string, stop: boolean) => {
    setBusyId(`trend:${stationId}:${stop ? "stop" : "start"}`);
    setError(null);
    setMessage(null);
    try {
      const r = await post<{ note: string; stationId: string }>("/api/admin/trend", {
        stationId,
        ...(stop ? { stop: true } : { risePerHr: 1.5, minutes: 10 }),
      });
      setMessage(r.note);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const logout = () => {
    setToken(null);
    setAuthUser(null);
    nav("/");
  };

  if (!user) return null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Authority console</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            signed in as <span className="text-emerald-300">{user.displayName}</span> ({user.email}) · role: {user.role}
            <span className="ml-2 chip border bg-ink-800 border-line normal-case">
              jurisdiction: {national ? <span className="text-slate-200">national</span> : <span className="text-cyan-300">{scopeLabel(user)}</span>}
            </span>
            {!national && <span className="ml-2 text-[11px] text-slate-600">only your region's stations &amp; alerts are shown</span>}
          </p>
        </div>
        <button onClick={logout} className="text-xs font-semibold px-3 py-1.5 rounded-md border border-line text-slate-400 hover:text-slate-200">
          sign out
        </button>
      </div>

      {(message || error) && (
        <div className={`mt-4 px-4 py-3 rounded-lg text-sm border ${message ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300" : "border-red-500/30 bg-red-500/5 text-red-400"}`}>
          {message ?? `✕ ${error}`}
        </div>
      )}

      <div className="mt-6 grid lg:grid-cols-3 gap-4">
        {/* Unacknowledged alerts */}
        <div className="panel overflow-hidden lg:col-span-2">
          <div className="px-4 py-2.5 border-b border-line flex items-center justify-between">
            <h2 className="panel-head">Unacknowledged alerts</h2>
            <span className="mono text-[11px] text-amber-400">{unacked.length} outstanding</span>
          </div>
          <div className="p-4">
            {unacked.length === 0 ? (
              <div className="text-sm text-slate-500 text-center py-6">
                ✓ no unacknowledged alerts — acknowledgement loop is current
              </div>
            ) : (
              <ul className="space-y-2">
                {unacked.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 bg-ink-850 border border-line rounded-lg px-3 py-2.5">
                    <RiskBadge category={a.category} score={a.riskScore} size="sm" />
                    <span className="text-sm text-slate-100 font-medium">{a.stationName}</span>
                    <span className="text-[11px] text-slate-500">{a.place}</span>
                    <span className="chip border bg-cyan-500/10 border-cyan-500/30 text-cyan-300">{a.channel}</span>
                    <span className="text-[11px] text-slate-500 mono truncate max-w-[180px]">{a.sentTo}</span>
                    <span className="ml-auto text-[11px] text-slate-500 mono">{fmtRelative(a.createdAt)}</span>
                    <button
                      onClick={() => ack(a.id)}
                      disabled={busyId === a.id}
                      className="text-xs font-semibold px-3 py-1.5 rounded-md border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                    >
                      {busyId === a.id ? "acknowledging…" : "✓ acknowledge"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4">
              <h3 className="panel-head mb-2">Recent dispatch log (outbox)</h3>
              <ul className="divide-y divide-line dim max-h-56 overflow-auto">
                {scopedAlerts.slice(0, 20).map((a) => (
                  <li key={a.id} className="py-1.5 flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${a.acknowledgedAt ? "bg-emerald-400" : "bg-amber-400"}`} />
                    <span className="text-[11px] mono text-slate-500">{fmtDateTime(a.createdAt)}</span>
                    <span className="chip border bg-ink-800 border-line text-slate-400">{a.channel}</span>
                    <span className="text-[11px] text-slate-400 truncate max-w-[220px] mono">{a.sentTo}</span>
                    <span className="text-[11px] text-slate-600">{a.deliveryState === "delivered" ? "delivered" : a.deliveryState === "logged-console" ? "logged (console)" : "provider rejected"}</span>
                    <span className="ml-auto text-[11px] text-slate-500">
                      {a.acknowledgedAt ? `✓ by ${a.acknowledgedBy}` : "open"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
{/* Simulation control */}
        <div className="panel p-4">
          <div className="flex items-center gap-2">
            <h2 className="panel-head">Simulation control</h2>
            <span className="chip border bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-300 text-[10px]">DEMO · SIMULATION MODE</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
            Injects a reading above the warning threshold right now (writes a real reading, recomputes risk
            server-side, dispatches to the demo list). Pure demo tooling — clearly labelled, never real telemetry.
            {!national && <> You can only simulate stations in your jurisdiction.</>}
          </p>
          {simStations.length === 0 ? (
            <p className="text-[11px] text-slate-600 mt-3">no simulated stations in your jurisdiction.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {simStations.map((s) => (
                <div key={s.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-300 truncate">{s.name}</span>
                    <button
                      onClick={() => triggerSpike(s.id)}
                      disabled={busyId === `spike:${s.id}`}
                      className="text-xs font-semibold px-3 py-1.5 rounded-md border border-warning/60 text-warning hover:bg-orange-500/10 disabled:opacity-50 shrink-0"
                    >
                      {busyId === `spike:${s.id}` ? "sending…" : "▲ push past warning"}
                    </button>
                  </div>
                  {/* gradual-rise lever: drives the "time to threshold" projection */}
                  <div className="mt-1 flex items-center gap-1.5 pl-2">
                    <span className="text-[10px] mono text-slate-600">GRADUAL RISE:</span>
                    <button
                      onClick={() => triggerTrend(s.id, false)}
                      disabled={busyId === `trend:${s.id}:start`}
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-md border border-amber-400/40 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
                    >
                      {busyId === `trend:${s.id}:start` ? "climbing…" : "⏳ +1.5 m/h"}
                    </button>
                    <button
                      onClick={() => triggerTrend(s.id, true)}
                      disabled={busyId === `trend:${s.id}:stop`}
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-md border border-line text-slate-300 hover:bg-ink-800 disabled:opacity-50"
                    >
                      {busyId === `trend:${s.id}:stop` ? "flattening…" : "⏹ flatten"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

          {/* Contacts */}
          <div className="panel p-4">
            <h2 className="panel-head">Demo recipient list</h2>
            <p className="text-[11px] text-slate-500 mt-1">configured in backend .env. Not an NDRF/DDMA integration.</p>
            <ul className="mt-2 divide-y divide-line dim">
              {contacts.map((c, i) => (
                <li key={i} className="py-2">
                  <div className="text-sm text-slate-200">{c.name}</div>
                  <div className="text-[11px] mono text-slate-500">
                    {c.channel.toUpperCase()} · {c.address}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Risk formula */}
          <div className="panel p-4">
            <h2 className="panel-head">Risk formula (per station)</h2>
            <p className="text-[11px] text-slate-500 mt-2 mono leading-relaxed">
              score = proximity·60 + rise·30 + rain·10
            </p>
            <p className="text-[11px] text-slate-500 mt-1 mono leading-relaxed">
              category: Normal 0–27 · Watch 28–49 · Warning 50–69 · Severe 70–87 · Critical 88–100
            </p>
            <p className="text-[11px] text-slate-500 mt-2">
              Weights and the rate-of-rise divisor are configurable per station (dams vs flashy hill rivers) — see
              <code className="mono text-slate-300"> services/riskEngine.ts</code>.
            </p>
          </div>
        </div>
      </div>

      {/* E2E workflow timeline — end-to-end, transparent (no black box) */}
      <div className="mt-6 panel p-4">
        <h2 className="panel-head">E2E workflow · how an alert travels</h2>
        <p className="text-[11px] text-slate-500 mt-1">
          Every stage below is a real step in this deployment — reading storage → server-side risk → dispatch →
          outbox → acknowledgement. Nothing is faked; "delivered" is only ever true when a provider confirms it.
        </p>
        <div className="mt-4 grid md:grid-cols-5 gap-3">
          {[
            {
              step: "1 · ingest",
              live: (st: StationDTO[] | null) => `${st?.filter((s) => s.latest).length ?? 0} gauges reporting`,
              detail: "Telemetry is stored with the source's own timestamp (never re-dated as 'now'). Sim tools write real reading rows, flagged simulated.",
            },
            {
              step: "2 · risk",
              live: null,
              detail: "Score = proximity·60 + rise·30 + rain·10, clamped 0–100, computed server-side; every score is explainable component-by-component.",
            },
            {
              step: "3 · threshold",
              live: null,
              detail: "Only Warning+ (score ≥ 50) crosses. Below Warning nothing is dispatched, and repeat alerts respect the station's cooldown window.",
            },
            {
              step: "4 · dispatch",
              live: null,
              detail: `SMS/email to the demo recipient list. Without provider keys the message is logged to the console and marked "logged (console)", never "delivered". ${scopedAlerts.length} outbox rows recorded.`,
            },
            {
              step: "5 · acknowledge",
              live: unacked.length ? `${unacked.length} still open` : "all acknowledged",
              detail:
                unacked.length
                  ? `Acting authority presses acknowledge → timestamp + identity stored on the alert row and pushed live to every client.`
                  : "Acknowledgement loop is current — every dispatch in your scope has a recorded acknowledgement.",
            },
          ].map((s) => (
            <div key={s.step} className="rounded-lg border border-line bg-ink-850 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] mono font-semibold text-accent">{s.step}</span>
                {typeof s.live === "function" && <span className="text-[10px] mono text-slate-500">{s.live(stations)}</span>}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">{s.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}