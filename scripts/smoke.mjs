#!/usr/bin/env node
/**
 * Jalrakshak — manual smoke suite (the verification gate before each feature
 * phase lands). Run against a live backend (:4000) + frontend (:5173).
 *
 *   node scripts/smoke.mjs            # API checks only (fast)
 *   node scripts/smoke.mjs --dom      # + headless-chrome DOM assertions
 *   node scripts/smoke.mjs --quiet    # summary only, exit code only
 */
import { execFileSync } from "node:child_process";

const API = process.env.SMOKE_API ?? "http://localhost:4000";
const WEB = process.env.SMOKE_WEB ?? "http://localhost:5173";
const DOM = process.argv.includes("--dom");
const QUIET = process.argv.includes("--quiet");
const CHROME = "/usr/bin/google-chrome";

let failures = 0;
let checks = 0;
const ok = (name) => { checks++; if (!QUIET) console.log(`  ✓  ${name}`); };
const bad = (name, detail) => { checks++; failures++; console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); };

async function getJson(path, timeoutMs = 30_000, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}${path}`, {
      signal: ctrl.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function dump(url, virtualTime = 9000) {
  const out = execFileSync(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox",
    `--virtual-time-budget=${virtualTime}`, "--dump-dom", url,
  ], { encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
  return out;
}

async function run() {
  console.log(`\nJALRAKSHAK SMOKE · ${API} · ${DOM ? "DOM checks ON" : "API-only"}\n`);

  // ── API: health -----------------------------------------------------------
  try {
    const h = await getJson("/api/admin/health", 10_000);
    if (h.ok === true) ok("backend health");
    else bad("backend health", JSON.stringify(h));
  } catch (e) {
    bad("backend health", e.message);
  }

  // ── API: stations ---------------------------------------------------------
  let stations = [];
  try {
    const r = await getJson("/api/stations");
    stations = r.stations ?? [];
    ok(`stations endpoint (${stations.length} stations)`);
  } catch (e) {
    bad("stations endpoint", e.message);
  }

  const nwdp = stations.filter((s) => s.source === "nwdp");
  if (nwdp.length === 6) ok("6 INDIA · NWDP stations present");
  else bad("6 INDIA · NWDP stations present", `found ${nwdp.length}`);

  const EXPECTED = [
    "Godavari at Bhadrachalam",
    "Godavari at Ambabal (Narangi)",
    "Godavari at Koida",
    "Ganga at Baisi",
    "Ganga at Arrah Chhapra Bridge",
    "Brahmaputra at NH-15 Fakirpara Tangni",
  ];
  const missing = EXPECTED.filter((n) => !nwdp.some((s) => s.name.includes(n)));
  if (missing.length === 0) ok("NWDP gauge names match catalogue");
  else bad("NWDP gauge names match catalogue", `missing ${missing.join(", ")}`);

  const live = stations.filter((s) => s.latest);
  const nonNumeric = live.filter((s) => typeof s.latest.riskScore !== "number" || !Number.isFinite(s.latest.riskScore));
  if (nonNumeric.length === 0) ok(`every one of ${live.length} stations with readings carries a numeric risk score`);
  else bad("every station with readings carries a numeric risk score", `${nonNumeric.map((s) => s.name).join(", ")}`);

  // Degenerate-score guard: Indian + simulated stations must never sit at a
  // stale/zero score (their levels are genuinely off the announced baseline).
  // UK EA nodes legitimately read exactly AT their typical-range baseline → 0.
  const indianLive = live.filter((s) => !["ukEA", "usgs"].includes(s.source));
  const zero = indianLive.filter((s) => typeof s.latest.riskScore === "number" && s.latest.riskScore <= 0);
  if (zero.length === 0) ok(`all ${indianLive.length} Indian/simulated stations with readings have risk > 0`);
  else bad("all Indian/simulated stations have risk > 0", `${zero.map((s) => `${s.name}@${s.latest.riskScore}`).join(", ")}`);

  const badCat = live.filter((s) => !["Normal", "Watch", "Warning", "Severe", "Critical"].includes(s.latest.category));
  if (badCat.length === 0) ok("all categories valid");
  else bad("all categories valid", badCat.map((s) => `${s.name}=${s.latest.category}`).join(", "));

  const arrah = nwdp.find((s) => s.name.includes("Arrah"));
  const nh15 = nwdp.find((s) => s.name.includes("NH-15"));
  if (arrah && arrah.latest && arrah.latest.category === "Warning") ok("Arrah Chhapra Bridge → Warning");
  else bad("Arrah Chhapra Bridge → Warning", arrah?.latest?.category ?? "no reading");
  if (nh15 && nh15.latest && nh15.latest.category === "Watch") ok("NH-15 Fakirpara Tangni → Watch");
  else bad("NH-15 Fakirpara Tangni → Watch", nh15?.latest?.category ?? "no reading");

  const demo = stations.filter((s) => s.simulated);
  if (demo.length >= 1 && demo.every((s) => s.simulated)) ok(`${demo.length} stations flagged simulated`);
  else bad("simulated flagging", "expected >=1 simulated, none flagged");

  // ── API: history ranges (72h backfill) -------------------------------------
  if (arrah) {
    try {
      const h48 = await getJson(`/api/stations/${arrah.id}/history?hours=48`);
      const h72 = await getJson(`/api/stations/${arrah.id}/history?hours=72`);
      const span48 = h48.points.length ? (h48.points[h48.points.length - 1].t - h48.points[0].t) / 3_600_000 : 0;
      if (h72.points.length >= h48.points.length && span48 > 4) ok(`Arrah history ranges (48h: ${h48.points.length}pts/${span48.toFixed(1)}h, 72h: ${h72.points.length}pts)`);
      else bad("Arrah history ranges", JSON.stringify({ n48: h48.points.length, span48, n72: h72.points.length }));
    } catch (e) {
      bad("Arrah history ranges", e.message);
    }
  }

  // ── API: alerts -----------------------------------------------------------
  try {
    const r = await getJson("/api/alerts");
    if (Array.isArray(r.alerts)) ok(`alerts feed (${r.alerts.length} rows)`);
    else bad("alerts feed", "not an array");
  } catch (e) {
    bad("alerts feed", e.message);
  }

  // ── API: multi-agency jurisdiction -----------------------------------------
  async function login(email, password) {
    const res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`login ${email} → HTTP ${res.status}`);
    return (await res.json()).token;
  }
  try {
    const tokAssam = await login("assam-sdma@demo.local", "DemoPass123!");
    const tokBihar = await login("bihar-sdma@demo.local", "DemoPass123!");
    const tokNdrf = await login("ndrf@demo.local", "ChangeMe123!");
    ok("3 authority accounts seed + login (Assam SDMA / Bihar SDMA / NDRF admin)");

    const assamAlerts = (await getJson("/api/alerts", 10_000, tokAssam)).alerts ?? [];
    const biharAlerts = (await getJson("/api/alerts", 10_000, tokBihar)).alerts ?? [];
    const ndrfAlerts = (await getJson("/api/alerts", 10_000, tokNdrf)).alerts ?? [];
    const regionOf = (stationId) => stations.find((s) => s.id === stationId)?.region ?? null;
    const allIn = (listA, region) => listA.every((a) => regionOf(a.stationId) === region || regionOf(a.stationId) == null);
    if (allIn(assamAlerts, "Assam") && allIn(biharAlerts, "Bihar") && ndrfAlerts.length >= Math.max(assamAlerts.length, biharAlerts.length)) {
      ok(`alert feed jurisdiction-scoped (NDRF ${ndrfAlerts.length} · Assam ${assamAlerts.length} [Assam only] · Bihar ${biharAlerts.length} [Bihar only])`);
    } else {
      bad("alert feed jurisdiction-scoped", JSON.stringify({ ndrf: ndrfAlerts.length, bihar: biharAlerts.length, assam: assamAlerts.length }));
    }

    const assamStation = stations.find((s) => s.name.includes("Guwahati"));
    const biharStation = stations.find((s) => s.name.includes("Arrah"));
    if (assamStation && biharStation) {
      const inScope = await fetch(`${API}/api/admin/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokAssam}` },
        body: JSON.stringify({ stationId: assamStation.id, level: assamStation.warningLevel + 0.5 }),
      });
      const outOfScope = await fetch(`${API}/api/admin/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokAssam}` },
        body: JSON.stringify({ stationId: biharStation.id, level: biharStation.warningLevel + 0.5 }),
      });
      if (inScope.ok && outOfScope.status === 403) ok("simulation scoped: in-jurisdiction ok, out-of-jurisdiction 403");
      else bad("simulation scoped", `inScope=${inScope.status} outOfScope=${outOfScope.status}`);
    } else {
      bad("simulation scoped", "Guwahati/Arrah station missing");
    }
  } catch (e) {
    bad("multi-agency jurisdiction", e.message);
  }

  // ── API: citizen email subscribe/unsubscribe (Item 14) ---------------------
  try {
    const smEmail = `smoke.citizen.${Date.now()}@example.com`;
    const postJson = (path, body, token) =>
      fetch(`${API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
    const subRes = await postJson("/api/subscribe", { email: smEmail, regions: ["Odisha"] });
    const subBody = await subRes.json();
    const uurl = subBody?.subscription?.unsubscribeUrl ?? "";
    const token = (uurl.split("token=")[1] ?? "").trim();
    if (subRes.status === 201 && subBody.subscription.email === smEmail && token) ok("citizen subscribe (no login) creates subscription w/ token");
    else bad("citizen subscribe", `status=${subRes.status} body=${JSON.stringify(subBody)}`);

    const inbox = await getJson(`/api/subscribe?token=${encodeURIComponent(token)}`);
    if (inbox.subscription?.email === smEmail && Array.isArray(inbox.notifications)) ok("demo inbox lookup by token");
    else bad("demo inbox lookup", JSON.stringify(inbox).slice(0, 200));

    const unRes = await postJson("/api/subscribe/unsubscribe", { token });
    const unBody = await unRes.json();
    if (unBody.unsubscribed === true && unBody.email === smEmail) ok("token-based unsubscribe deletes subscription");
    else bad("token-based unsubscribe", JSON.stringify(unBody));

    const gone = await fetch(`${API}/api/subscribe?token=${encodeURIComponent(token)}`);
    if (gone.status === 404) ok("unsubscribed token now 404");
    else bad("unsubscribed token now 404", `status=${gone.status}`);

    const badEmail = await postJson("/api/subscribe", { email: "not-an-email" });
    if (badEmail.status === 400) ok("subscribe rejects malformed email (400)");
    else bad("subscribe rejects malformed email", `status=${badEmail.status}`);
  } catch (e) {
    bad("citizen subscribe/unsubscribe", e.message);
  }

  if (!DOM) {
    console.log(`\nSMOKE RESULT: ${checks - failures}/${checks} passed, ${failures} failed`);
    process.exit(failures ? 1 : 0);
  }

  // ── DOM: dashboard --------------------------------------------------------
  try {
    const dom = dump(`${WEB}/`);
    const nwdpChips = (dom.match(/INDIA · NWDP/g) ?? []).length;
    if (nwdpChips >= 6) ok(`dashboard shows ≥6 NWDP source chips (${nwdpChips})`);
    else bad(`dashboard shows ≥6 NWDP source chips`, `found ${nwdpChips}`);
    for (const [name, cat] of [["Arrah", "Warning"], ["NH-15", "Watch"]]) {
      const s = nwdp.find((x) => x.name.includes(name));
      const expectedTile = s?.name.includes("Arrah") ? "Arrah Chhapra Bridge" : "Fakirpara Tangni";
      if (dom.includes(expectedTile)) ok(`dashboard tile "${expectedTile}"`);
      else bad(`dashboard tile "${expectedTile}"`);
      if (dom.includes(cat)) ok(`dashboard shows category ${cat}`);
      else bad(`dashboard shows category ${cat}`);
    }
  } catch (e) {
    bad("dashboard DOM", e.message);
  }

  // ── DOM: detail page ------------------------------------------------------
  if (arrah) {
    try {
      const dom = dump(`${WEB}/station/${arrah.id}`);
      if (dom.includes("svg")) ok("detail page renders chart svg");
      else bad("detail page renders chart svg", "no <svg> in dump");
      const rangeButtons = ["6h", "12h", "24h", "48h", "72h"].filter((h) => dom.includes(`>${h}<`) || dom.includes(`${h}</button>`)).length;
      if (rangeButtons >= 4) ok(`detail page range buttons (${rangeButtons}/5)`);
      else bad("detail page range buttons", `found ${rangeButtons}/5`);
      if (dom.includes("Alerts for this station")) ok("detail page alert section");
      else bad("detail page alert section");
      if (dom.includes("Why this score")) ok("detail page explainable-risk panel");
      else bad("detail page explainable-risk panel");
      if (dom.includes("ESTIMATED TIME to threshold") || dom.includes("time to threshold")) ok("detail page prediction panel");
      else bad("detail page prediction panel");
    } catch (e) {
      bad("detail page DOM", e.message);
    }
  }

  // ── DOM: public view ------------------------------------------------------
  try {
    const dom = dump(`${WEB}/public`);
    for (const t of ["What the colours mean", "River status for your district", "Get alerts by email", "CHECK YOUR AREA"]) {
      if (dom.includes(t)) ok(`public page has "${t}"`);
      else bad(`public page has "${t}"`);
    }
  } catch (e) {
    bad("public page DOM", e.message);
  }

  console.log(`\nSMOKE RESULT: ${checks - failures}/${checks} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

run().catch((e) => {
  console.error("[smoke] fatal:", e.message);
  process.exit(1);
});