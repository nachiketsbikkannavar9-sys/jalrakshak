import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../../../shared/src/index.js";
import { post, setAuthUser, setToken } from "../lib/api";

export function AuthorityLogin() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ token: string; user: AuthUser }>("/api/auth/login", { email, password });
      setToken(r.token);
      setAuthUser(r.user);
      nav("/authority");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto px-4 py-16">
      <div className="panel p-6">
        <h1 className="text-lg font-semibold text-white">Authority login</h1>
        <p className="text-xs text-slate-500 mt-1">
          Flood-cell / district-officer only. Alerts, acknowledgement and demo tools live behind this.
        </p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            className="w-full bg-ink-850 border border-line rounded-md px-3 py-2 text-sm placeholder:text-slate-600 focus:outline-none focus:border-accent/60"
          />
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            className="w-full bg-ink-850 border border-line rounded-md px-3 py-2 text-sm placeholder:text-slate-600 focus:outline-none focus:border-accent/60"
          />
          {error && <div className="text-xs text-red-400">✕ {error}</div>}
          <button
            disabled={busy}
            className="w-full rounded-md bg-accent text-ink-950 font-semibold text-sm py-2 hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "signing in…" : "Sign in"}
          </button>
        </form>
        <div className="mt-4 text-[11px] text-slate-500 leading-relaxed">
          Demo credentials (also shown in server log at boot):
          <code className="block mt-1 bg-ink-850 border border-line rounded px-2 py-1 mono text-slate-300">
            ndrf@demo.local · ChangeMe123! · national admin
          </code>
          <code className="block mt-1 bg-ink-850 border border-line rounded px-2 py-1 mono text-slate-300">
            assam-sdma@demo.local · DemoPass123! · Assam
          </code>
          <code className="block mt-1 bg-ink-850 border border-line rounded px-2 py-1 mono text-slate-300">
            bihar-sdma@demo.local · DemoPass123! · Bihar
          </code>
        </div>
      </div>
    </div>
  );
}