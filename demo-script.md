# Jalrakshak — 90-second live demo script (for judges)

Setup on your machine (~2 min, do this **before** judges arrive):

```bash
cp .env.example backend/.env
npm install
npm run db:setup
npm run dev            # backend :4000 · frontend :5173
```

Demo participants: add yourself as a recipient + enable a real channel so a
message actually lands on the phone you demo with:

```
# backend/.env
ALERT_RECIPIENT_EMAILS=you@judge-demonstration.com
ALERT_RECIPIENT_PHONES=+919123456789     (twilio)
```

Also open a second browser tab (incognito) signed in as the authority:
<http://localhost:5173/authority> · `ndrf@demo.local` / `ChangeMe123!`.

---

## 90 seconds

| :10 | Open **http://localhost:5173** — full-screen dashboard. "What you’re seeing is a national flood early-warning console. Every dot is a gauging station with water-level telemetry, coloured by server-computed risk. The live stations are *real* telemetry from national hydrological agencies’ open APIs — including six Indian CWC/state-department gauges on the Godavari, Ganga and Brahmaputra streaming through India’s National Water Data Portal — and the purple ones are **simulated** stations we scripted for this demo, like ‘Brahmaputra at Guwahati’. Nothing is faked as ‘live now’ — the data is labelled with its true recency." |
|---|---|

| :25 | **Drill into the Brown station.** "Open 'Brahmaputra at Guwahati' — live level *now*, risk score, and the trend chart for the last 6/24 h with the warning and danger thresholds drawn in. The risk isn't a UI animation: it's computed server-side each poll from level proximity, rise rate, and rainfall — dam vs. flashy river get different weightings, stored per station."

| :40 | **Make it happen live.** "Now watch the engine react." Run the spike tool:
```bash
curl -X POST http://localhost:4000/api/admin/simulate \
  -H "Authorization: Bearer <ndrf-token>" -H "Content-Type: application/json" \
  -d '{"stationId":"brahmaputra-guwahati","mode":"past-warning"}'
```
Or, faster: in the authority console it's one button ("▲ push past warning").
The Brahmaputra jumps to ~90% between normal and danger levels — a firm,
honest warning breach — and the JS slider, the dashboard card, and the
Alerts page all update **over WebSocket**.

| :55 | **Show the Alerts feed.** "An alert was generated server-side and dispatched — SMS *and* email — to the configured recipient list. Here's the outbox: channel, recipient role ('NDRF Control Room'), delivery status. In production these go out through Resend/Twilio to the real routing that CWC uses to reach NDMA → NDRF → district authorities."

| :1:10 | **The acknowledgement loop.** Switch to the authority tab → **Acknowledge**. "Every alert carries an acknowledgement so nobody can later claim it was missed — the timestamped, role-stamped ack is persisted and broadcast back to the team."

**Close the loop:** "That's the full warning chain: *telemetry → risk → escalation to a named authority → verified response*. Every link works today; sources and channels are pluggable, so a CWC feed and NDMA routing drop in without touching the core."