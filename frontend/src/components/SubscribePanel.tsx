import { useMemo, useState, type FormEvent } from "react";
import type { StationDTO } from "../../../shared/src/index.js";
import { post } from "../lib/api";

interface SubResult {
  subscription: {
    email: string;
    watching: string;
    unsubscribeUrl: string;
  };
}

/** No-login citizen email subscribe (Item 14): watch a state/region or a gauge. */
export function SubscribePanel({ stations }: { stations: StationDTO[] }) {
  const [email, setEmail] = useState("");
  const [region, setRegion] = useState("");
  const [stationId, setStationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SubResult["subscription"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const s of stations) {
      if (s.region && !["United Kingdom", "United States"].includes(s.region)) set.add(s.region);
    }
    return [...set].sort();
  }, [stations]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const body: Record<string, unknown> = { email };
      if (region) body.regions = [region];
      if (stationId) body.stationIds = [stationId];
      const r = await post<SubResult>("/api/subscribe", body);
      setDone(r.subscription);
      setEmail("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel p-4">
      <h2 className="panel-head">Get alerts by email</h2>
      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
        No login needed. Choose a state or a specific gauge — we'll email you in plain language the moment one of
        your watched rivers moves to Warning or worse. Unsubscribe anytime via the link in the email.
      </p>
      <form onSubmit={submit} className="mt-3 grid sm:grid-cols-4 gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="sm:col-span-2 bg-ink-850 border border-line rounded-md px-3 py-2 text-sm placeholder:text-slate-600 focus:outline-none focus:border-accent/60"
        />
        <select
          value={region}
          onChange={(e) => {
            setRegion(e.target.value);
            if (e.target.value) setStationId("");
          }}
          className="bg-ink-850 border border-line rounded-md px-2 py-2 text-sm text-slate-300 focus:outline-none focus:border-accent/60"
        >
          <option value="">any state</option>
          {regions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
          value={stationId}
          onChange={(e) => {
            setStationId(e.target.value);
            if (e.target.value) setRegion("");
          }}
          className="bg-ink-850 border border-line rounded-md px-2 py-2 text-sm text-slate-300 focus:outline-none focus:border-accent/60"
        >
          <option value="">any gauge</option>
          {stations
            .filter((s) => s.source !== "ukEA" && s.source !== "usgs")
            .map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
        </select>
        <button
          disabled={busy}
          className="sm:col-span-4 mt-1 rounded-md bg-accent text-ink-950 font-semibold text-sm py-2 hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "subscribing…" : "Subscribe to river alerts"}
        </button>
      </form>

      {done && (
        <div className="mt-3 px-3 py-2.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 text-emerald-300 text-xs">
          ✓ <b>{done.email}</b> is subscribed — watching <b>{done.watching}</b>. A confirmation is queued for the
          demo outbox. Manage anytime:{" "}
          <a href={done.unsubscribeUrl} className="underline">unsubscribe link</a>
        </div>
      )}
      {error && <div className="mt-3 text-xs text-red-400">✕ {error}</div>}
      <p className="mt-3 text-[10px] text-slate-600">
        Demo channel — plain-language emails are logged to the backend console and stored in the demo inbox, and are
        clearly labelled as <b>not</b> an official NDMA/NDRF alert.
      </p>
    </div>
  );
}