# Jalrakshak 🌊

**Flood & water-level early-warning system for lakes, rivers and dams** — a
full-stack, end-to-end working build for the national hackathon: real telemetry
in, server-side risk scoring, real alert dispatch to a configurable contact
list, and an authority acknowledgement loop.

> Modelled on **CWC's National Flood Forecasting Network** (station → threshold
> → forecast → routed alert to a named authority) with the citizen/authority
> split of **FloodWatch India**, the map-first reservoir framing of
> **India-WRIS**, and the open-data-first philosophy of the **National Water
> Data Portal**.

---

## What actually runs (be precise — it matters in front of judges)

| Piece | Real integration | Demo stand-in |
|---|---|---|
| Live water-level telemetry | **UK Environment Agency** flood-monitoring API (real rivers in England, no key, no registration) & **USGS** Instantaneous Values (US gauges, no key) | `demo` adapter: 6 **Indian** stations (Brahmaputra at Guwahati, Ganga at Patna, Godavari at Polavaram, …) whose values are **SIMULATED** and clearly labelled "SIMULATED" in the UI. Metadata is illustrative, not official CWC bulletin data. |
| Risk scoring | Computed **server-side** from stored readings (`services/riskEngine.ts`), reproducible, not frontend-random. Configurable per station. | — |
| Alert dispatch | **Resend** (email) / **Twilio** (SMS) — real messages if keys are in `.env` | Without keys, alerts still fire **end-to-end** into the app's alert feed & outbox via a "console-demo" channel (stored in DB, visible in UI). |
| Alert recipients | Configurable list in `.env` | free demo list, e.g. a team member playing **NDRF control room**. The app says plainly this is **not** an NDRF/NDMA integration. |
| Authority loop | JWT auth + `POST /api/alerts/:id/acknowledge`; ack persists (`acknowledged_at`, `acknowledged_by`) and broadcasts over WebSocket | — |

**Why UK EA / USGS instead of CWC telemetry?** India-WRIS / NWDP's CKAN
datastore **is** wired (`nwdp` adapter — 6 real CWC/state gauges, Godavari ×3,
Ganga ×2, Brahmaputra ×1, no key; see *Plugging in CWC / India-WRIS*). The
architecture is **source-agnostic** — every source implements the same
`WaterDataAdapter` interface, so any CWC feed can be swapped in without
touching the risk engine, alerts, or UI. The adapter list is a one-line config
change:

```
DATA_ADAPTERS=ukEA,demo,nwdp  # live UK + REAL CWC/India telemetry (NWDP) + simulated alert demo
DATA_ADAPTERS=ukEA,demo       # live UK + simulated Indian alert scenario
DATA_ADAPTERS=usgs,demo       # USGS live + demo
DATA_ADAPTERS=seed            # fully offline deterministic fallback
```

---

## Stack

- **Frontend:** React 18 + TypeScript + Vite · Tailwind CSS · Recharts ·
  react-leaflet (OpenStreetMap, dark CARTO tiles — no paid map key) · Socket.IO client
- **Backend:** Node 22 + TypeScript (tsx) · Express 4 · Socket.IO · node-cron ·
  Prisma 5
- **Database:** PostgreSQL. For the demo it runs as a **real embedded PostgreSQL 18**
  (binaries ship in `node_modules`, no Docker/root needed). In production point
  `DATABASE_URL` at Neon/Railway/Supabase.
- **Deploy:** frontend → Vercel/Netlify, backend → Render/Railway. One monorepo.

---

## Project layout

```
.
├── shared/src/index.ts        # types contract (RiskCategory, DTOs, risk parts)
├── backend/
│   ├── src/
│   │   ├── adapters/          # one file per source, all implement WaterDataAdapter
│   │   │   ├── ukEA.adapter.ts    # live (no key)
│   │   │   ├── usgs.adapter.ts    # live (no key)
│   │   │   ├── nwdp.adapter.ts    # REAL CWC/state telemetry via NWDP (no key)
│   │   │   ├── demo.adapter.ts    # simulated Indian scenario (alert demo)
│   │   │   └── seed.adapter.ts    # deterministic offline fallback
│   │   ├── services/          # riskEngine, alertDispatcher, scheduler, syncService, dto, openMeteo
│   │   ├── routes/            # stations, alerts, auth, admin
│   │   ├── db/                # schema.prisma, prisma client, embeddedPg.ts
│   │   └── server.ts
│   └── scripts/setup-db.mjs   # boots embedded Postgres + creates the DB
└── frontend/
    └── src/
        ├── pages/             # Dashboard, StationDetail, Alerts, AuthorityLogin, AuthorityConsole
        ├── components/        # StationCard, MapView, TrendChart, AlertFeed, RiskBadge, …
        └── lib/               # api.ts, socket.ts, risk.ts, format.ts
```

---

## Run it locally (3 commands, ~2 minutes)

Prereqs: Node 20+ (npm installs the PostgreSQL 18 binaries automatically).

```bash
cp .env.example backend/.env
npm install
npm run db:setup        # starts embedded Postgres 18 + creates DB + prisma db push
npm run dev             # backend :4000 + frontend :5173
```

Open **http://localhost:5173**.

### Automated tests, smoke suite

```bash
npm test             # vitest: backend (risk engine, projection, jurisdiction scope,
                     #   dispatch gate, NWDP bounds, citizen emails) + frontend libs
npm run smoke        # live smoke gate: API checks (node scripts/smoke.mjs)
npm run smoke -- --dom   # + headless-chrome DOM assertions against :5173
```

- Data sources that publish during this build start with a 0–90 s telemetry
  sync (UK EA discovery) — the dashboard is already usable; live UK readings
  populate as polls land.
- **Authority login** (to acknowledge alerts / force a spike):
  `ndrf@demo.local` / `ChangeMe123!` (configured via `AUTHORITY_*` env).
- **For the public** — `/public` is a read-only citizen view (map + plain-language
  "what to do" guidance per risk colour, including the grey "no data" case). No
  login, no admin levers.

### Send a real SMS/email (optional)

Add to `backend/.env` (then restart):

```
RESEND_API_KEY=re_...
ALERT_EMAIL_FROM=Jalrakshak Demo <onboarding@resend.dev>
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=+15551234567
```

Without these, everything still works — the dispatcher stores each message in
the `alerts` table and labels the delivery channel `console-demo`; the alert
feed and authority console show it as delivered.

### Full clean reset

```bash
rm -rf backend/.pgdata && npm run db:setup
```

---

## Risk scoring (server-side, per-station tunable)

```
proximity   = clamp((level − normal) / (danger − normal), 0, 1)
riseRate    = (latest − previous) / Δhours                  # m/h, positive = rising
riseNorm    = clamp(riseRate / ((danger − normal) · divisor), 0, 1)
rainfall    = clamp(forecastMm / 100, 0, 1)                 # optional, Open-Meteo

riskScore   = round( proximity·60 + riseNorm·30 + rainfall·10 )

category    0–27 Normal · 28–49 Watch · 50–69 Warning · 70–87 Severe · 88–100 Critical
```

- Weights (60/30/10) and the rate-of-rise `divisor` are stored **per station**
  (a dam behaves differently from a flashy hill river — see `Station.*` in
  `schema.prisma` and the `demoStations.ts` overrides).
- `Warning` (≥50) crosses the alert trigger; a per-station `alertCooldownMin`
  prevents re-firing within the window.
- Rainfall is a second signal via Open-Meteo for stations with
  `rainfallEnabled` (cached hourly) — the risk engine is **not** level-only.
- **Time-to-threshold projection** (`latest.projection` on every station DTO,
  surfaced on dashboard cards and station detail): `hoursToWarning` /
  `hoursToDanger` = `(threshold − level) / riseRate`. Honest linear
  extrapolation only — it is `null` while the river is steady/falling, when
  the rate can't be computed (raw readings < 2 min apart), past a threshold
  already reached, or beyond a 72 h horizon. The alert SMS/email template
  appends "Still rising — ~Xh to danger level (linear estimate)" when a
  danger projection is available.

---

## API

```
GET  /api/stations                   → stations + latest readings + sparklines + national stats
GET  /api/stations/:id               → one station DTO
GET  /api/stations/:id/history?hours → history points + interval stats (warning/danger lines on chart)
GET  /api/alerts                     → dispatch feed (SMS/email rows, delivery + ack state)
GET  /api/alerts/contacts            → the configured demo recipient list (auth)
POST /api/alerts/:id/acknowledge     → authority acknowledges an alert (auth)
POST /api/auth/login                 → authority JWT
POST /api/auth/register              → create a district-officer account (auth open for the demo)
POST /api/admin/simulate             → demo tool: push a station's level now (admin)
POST /api/admin/trend                → demo tool: script a GRADUAL rise (risePerHr, minutes; stop:true flattens). Writes ≥2-min-spaced readings so the honest "time to threshold" projection appears and tracks the climb (admin)
GET  /api/admin/health               → liveness
WS   (Socket.IO)  station:update · alert:new · alert:acked · app:boot
```

---

## Plugging in CWC / India-WRIS (production path)

**Already wired:** `adapters/nwdp.adapter.ts` reads the National Water Data
Portal (`nwdp.nwic.gov.in`) CKAN datastore — **6 real CWC / state-department
telemetry gauges** (Godavari ×3, Ganga ×2, Brahmaputra ×1) feeding through the
*exact same* station lifecycle as ukEA: real acquisition timestamps (never
re-dated as "now"), real levels, per-station thresholds, risk scoring, and
alerts. No API key required.

Per-gauge **sanity bounds** reject malformed upstream rows instead of writing
them (the raw series contain glitches like Bhadrachalam 262.48 m and Baisi
722.95 m): a level must be ≥ 0 and ≤ `max(200 m, 3 × danger)` unless the
station is explicitly configured otherwise (e.g. Ambabal/Narangi is a genuine
~535 m-RL highland gauge, bounds set explicitly). Rejections log the full raw
record; set `NWDP_DEBUG=1` to dump every raw row before parsing. The adapter
also **backfills the last ~72 h of hourly telemetry** per gauge, so the detail
page's 6h–72h range buttons render genuinely different windows.

To take it further:

1. **More stations** — the portal's `River Water Level (Telemetry — Hourly)`
   packages split by agency/basin/decade. Add any gauge by its `resource_id`
   (datastore `datastore_search` + `sort=_id desc`) to `RESOURCES`/`CATALOG` in
   `nwdp.adapter.ts`. Nothing else changes — the risk engine, alerts, and UI are
   source-agnostic.
2. **Official thresholds** — replace the inferred band (`normal` = q10 − 0.3 m,
   `warning` = q90 or mid-band, `danger` = q99 + 0.3 m, all from the gauge's own
   2026 telemetry and labelled as inferred) with CWC-announced HFL/warning/
   danger levels per Flood Forecasting Network bulletin once CWC publishes them
   through the portal.
3. **Fresher sweep** — upstream refreshes the datastore as CWC/state teams
   publish; the adapter takes the latest samples per poll. To match a true
   near-real-time feed, point `fetchReadings` at the same portal's streaming
   API when it opens up.
4. **Real dissemination** — CWC routes forecasts to NDMA, NDRF, state
   governments and district authorities via SMS/email/fax. The alert autoplay
   here is identical: touch `alertDispatcher.ts` to add your own provider
   (e.g. Government SMS gateway / NDRF alert API), or keep the existing
   Resend/Twilio/console provider chain. The recipient list already models a
   "routed alert to a named authority" (role-tagged contacts).
5. **Weights** — re-tune `riseNormDivisor`/weights per river system (flashy
   hill rivers vs. dammed reaches) in the station registry.

---

## Honesty box (keeps the demo credible)

- ❌ **Not** connected to NDRF, CWC, NDMA, or any government system.
- ❌ 6 of the Indian stations earn **SIMULATED**-only data (illustrative
  thresholds, scripted flood scenarios).
- ✅ **Real Indian data:** 6 CWC/state telemetry gauges (Godavari, Ganga,
  Brahmaputra) stream via NWDP with true acquisition timestamps — shown
  "as-published", never faked as live-now.
- ✅ Live readings do come from **real** national agencies' open APIs (UK EA,
  USGS) — truthfully labelled on the map and cards.
- ✅ Every alert row is real (stored, timestamped, per recipient); real
  delivery depends only on the optional provider keys.

---

## Environment

See `.env.example` for every variable with defaults & comments. Never commit
`.env`; secrets are read from `backend/.env` (and repo-root `.env`).

Deployment rows that matter:
- **render/railway backend**: `DATABASE_URL` → Neon/Railway Postgres,
  `AUTO_START_PG=0`, `DATA_ADAPTERS=ukEA,demo`, start `npm run start -w backend`.
- **vercel/netlify frontend**: build `npm run build -w frontend`, set
  `VITE_API_BASE=https://<backend>/`.