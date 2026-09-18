import { NavLink, useNavigate } from "react-router-dom";
import { getAuthUser } from "../lib/api";

export function Header() {
  const nav = useNavigate();
  const user = getAuthUser();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink-950/85 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-5">
        <NavLink to="/" className="flex items-center gap-2.5 shrink-0">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
            <circle cx="16" cy="16" r="14" fill="none" stroke="#22d3ee" strokeWidth="2" />
            <path d="M6 19c3-6 7-6 10 0s7 6 10 0" fill="none" stroke="#22d3ee" strokeWidth="2" />
          </svg>
          <div className="leading-tight">
            <div className="font-semibold tracking-tight text-white">
              JALRAKSHAK<span className="text-accent">.</span>
            </div>
            <div className="text-[9px] uppercase tracking-[0.22em] text-slate-500">flood early-warning</div>
          </div>
        </NavLink>

        <nav className="flex items-center gap-1 text-sm ml-2">
          {[
            { to: "/", label: "Dashboard" },
            { to: "/public", label: "For the public" },
            { to: "/alerts", label: "Alerts" },
          ].map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/"}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md transition-colors ${
                  isActive ? "bg-ink-800 text-accent" : "text-slate-400 hover:text-slate-200"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="chip hidden sm:inline-flex bg-ink-800 border border-line text-slate-500 normal-case tracking-normal">
            {user ? `● ${user.displayName}` : "citizen view · read-only"}
          </span>
          <button
            onClick={() => nav(user ? "/authority" : "/auth/login")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
              user
                ? "border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                : "border-accent/50 text-accent hover:bg-accent/10"
            }`}
          >
            {user ? "Authority console" : "Authority login"}
          </button>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-10 border-t border-line py-5 text-center">
      <p className="text-[11px] text-slate-600 max-w-3xl mx-auto px-4 leading-relaxed">
        <span className="text-slate-500 font-semibold">Jalrakshak</span> — hackathon build. Live data: UK Environment
        Agency / USGS APIs (no key). Indian stations are <span className="text-purple-400">SIMULATED</span>. Alerts go
        to a <span className="text-amber-400">demo distribution list</span> — <span className="font-semibold">not</span>{" "}
        an NDRF/NDMA/CWC integration. Architecture is source-agnostic; see README for production wiring.
      </p>
    </footer>
  );
}