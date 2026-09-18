import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { get, post } from "../lib/api";

interface InboxView {
  subscription?: {
    email: string;
    watching: string;
    unsubscribeUrl: string;
  };
  notifications?: Array<{
    stationId: string;
    level: number;
    riskScore: number;
    category: string;
    body: string;
    state: string;
    sentTo: string;
    createdAt: string;
  }>;
}

/**
 * Token URL: /unsubscribe?token=…  Shown when a subscriber follows the link in
 * a citizen email. Offers an honest one-click unsubscribe (deletes the row) and,
 * while a token is valid, lets the subscriber peek at the demo inbox.
 */
export function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"loading" | "invalid" | "ready" | "gone">("loading");
  const [view, setView] = useState<InboxView | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    get<InboxView>(`/api/subscribe?token=${encodeURIComponent(token)}`)
      .then((r) => {
        setView(r);
        setState("ready");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  const unsubscribe = async () => {
    const r = await post<{ unsubscribed: boolean; email?: string }>("/api/subscribe/unsubscribe", { token });
    if (r.unsubscribed) {
      setMessage(`You're unsubscribed${r.email ? ` (${r.email})` : ""}. No further Jalrakshak demo alerts will be emailed to this address.`);
      setState("gone");
    } else {
      setMessage(r.email === undefined ? "No active subscription was found for that link — nothing to remove." : "");
      setState("gone");
    }
  };

  if (state === "loading") {
    return <div className="max-w-2xl mx-auto px-4 py-16 text-center text-slate-500 mono">checking subscription…</div>;
  }

  if (state === "invalid" || !view?.subscription) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-lg text-white">Whoops — that link isn't valid</h1>
        <p className="mt-2 text-sm text-slate-500">
          The unsubscribe token was missing or already used. Use the link from the most recent Jalrakshak email, or
          just ignore it and we won't bother you.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-lg text-white">Manage your river alerts</h1>
      <div className="mt-3 panel p-4 text-sm text-slate-300">
        <div><span className="text-slate-500">Email:</span> <b>{view.subscription.email}</b></div>
        <div className="mt-1"><span className="text-slate-500">Watching:</span> {view.subscription.watching}</div>
        <button
          onClick={unsubscribe}
          className="mt-4 rounded-md bg-red-500/90 text-white text-sm font-semibold px-4 py-2 hover:bg-red-400 disabled:opacity-50"
        >
          Unsubscribe (one click — removes this subscription)
        </button>
        {state === "gone" && message && <div className="mt-4 text-xs text-emerald-300">✓ {message}</div>}
      </div>

      {state === "ready" && view.notifications && view.notifications.length > 0 && (
        <div className="mt-6">
          <h2 className="panel-head">Demo inbox — alerts sent to this address</h2>
          <div className="mt-3 space-y-3">
            {view.notifications.map((n, i) => (
              <div key={i} className="panel p-4 whitespace-pre-wrap font-mono text-[12px] text-slate-400 leading-relaxed">
                <div className="text-[10px] text-slate-600 mb-1">
                  {n.sentTo} · {new Date(n.createdAt).toLocaleString()} · {n.state}
                </div>
                {n.body}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}