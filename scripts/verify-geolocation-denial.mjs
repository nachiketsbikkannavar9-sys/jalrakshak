#!/usr/bin/env node
// Spec acceptance TEST 4: "geolocation is denied → the fix is a working manual
// coordinates fallback; the UI must degrade gracefully."
//
// Drives real headless Chrome over plain CDP (Node 22 global WebSocket,
// zero new deps) against http://localhost:5173/public:
//  1. geolocation.getCurrentPosition is made to fail PERMISSION_DENIED
//  2. "Use my location" is clicked → the denial message must appear
//  3. manual lat/lng inputs must exist, and entering valid coords must produce
//     a real /api/location/exposure result (the full model, not a stub)

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WEB = process.env.SMOKE_WEB ?? "http://localhost:5173";
const PORT = 9333;
const CHROME = "/usr/bin/google-chrome";
const LAT = "25.7167";
const LNG = "84.8117";

const profile = mkdtempSync(join(tmpdir(), "t4-"));
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--disable-dev-shm-usage",
  "about:blank",
], { stdio: "ignore" });

let failures = 0;
const check = (name, okp, detail = "") => {
  console.log(`  ${okp ? "✓" : "✗"}  ${name}${!okp && detail ? ` — ${detail}` : ""}`);
  if (!okp) failures++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = `http://127.0.0.1:${PORT}/json/list`;

async function pageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const infos = await (await fetch(api)).json();
      const page = infos.find((t) => t.type === "page");
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error("chrome devtools target not ready");
}

const wsUrl = (await pageTarget()).webSocketDebuggerUrl;
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let mid = 0;
const pending = new Map();
const urls = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === "Network.requestWillBeSent" && m.params?.request?.url?.includes("/api/location/exposure")) {
    urls.push(m.params.request.url);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++mid;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.error || r.result?.exceptionDetails) {
    const d = r.result?.exceptionDetails?.exception?.description ?? r.error?.message ?? "";
    throw new Error(`eval failed: ${d}`);
  }
  return r.result?.result?.value;
};
const waitFor = async (expr, timeoutMs = 25_000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if (await evalJs(expr)) return true; } catch {}
    await sleep(300);
  }
  return false;
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Page.navigate", { url: `${WEB}/public` });

  check("public page loads (heading visible)", await waitFor(
    `document.querySelector('h1, h2, h3') && document.body.innerText.includes('CHECK YOUR FLOOD RISK — PERSONAL EXPOSURE') || document.body.innerText.includes('PERSONAL EXPOSURE')`
  ));

  // 1. Make geolocation deterministically fail with PERMISSION_DENIED in the
  //    LIVE page context (fluid equivalent of the browser refusing the prompt).
  await evalJs(`(() => {
    const g = navigator.geolocation;
    if (g) {
      g.getCurrentPosition = (ok, err) => {
        setTimeout(() => {
          if (typeof err === "function") err({ code: 1, PERMISSION_DENIED: 1, message: "User denied Geolocation" });
        }, 40);
      };
    }
  })()`);

  // 2. Click "Use my location".
  await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === "Use my location");
    if (b) b.click();
  })()`);

  const denied = await waitFor(
    `document.body.innerText.includes("Location permission denied") && document.body.innerText.includes("enter coordinates manually")`, 10_000
  );
  check("geolocation denied → graceful fallback message", denied,
    "expected 'Location permission denied — enter coordinates manually or try a demo preset.'");

  const hasManualInputs = await evalJs(
    `!!document.querySelector('input[aria-label="Latitude"]') && !!document.querySelector('input[aria-label="Longitude"]')`
  );
  check("manual lat/lng inputs present after denial", hasManualInputs === true);

  // 3. Enter valid coords (Arrah gauge) → real exposure result via the API.
  await evalJs(`(() => {
    const set = (el, v) => {
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(document.querySelector('input[aria-label="Latitude"]'), "${LAT}");
    set(document.querySelector('input[aria-label="Longitude"]'), "${LNG}");
  })()`);

  // The badge is a text node inside a div ("PERSONAL EXPOSURE · {category}") —
  // the card header reads the same words only via CSS `uppercase`, so select the
  // SHORTEST element whose trimmed textContent starts with "PERSONAL EXPOSURE ·".
  const badgeExpr = `(() => {
    const hits = [...document.querySelectorAll('div, span')]
      .map((e) => e.textContent.trim())
      .filter((t) => t.startsWith('PERSONAL EXPOSURE · ') && t.length < 60);
    return hits.sort((a, b) => a.length - b.length)[0] ?? null;
  })()`;
  const resultShown = await waitFor(`(${badgeExpr}) !== null`, 20_000);
  check("manual coords → personal exposure result rendered", resultShown);

  const badgeText = await evalJs(badgeExpr);
  const category = badgeText ? badgeText.split(" · ")[1] : null;
  const valid = ["Normal", "Watch", "Warning", "Severe", "Critical"].includes(category ?? "");
  check(`badge shows a real risk category (${category})`, valid, category ?? "no badge");

  // The result card points at a real gauge + prints the chosen point as
  // lat.toFixed(5), lng.toFixed(5) — must be exactly OUR manual coordinates
  // (proves the live model evaluated OUR point, not a preset/pin).
  const coordsShown = await waitFor(
    `document.documentElement.innerText.includes("${LAT}0") && document.documentElement.innerText.includes("${LNG}0")`, 8_000
  );
  check(`live exposure evaluated at manual coords ${LAT}, ${LNG}`, coordsShown);

  const closestGauge = await evalJs(
    `(/Closest gauge:/.test(document.documentElement.innerText))`
  );
  check("result names the closest monitored gauge", closestGauge === true);
} catch (e) {
  check("CDP run", false, e.message);
} finally {
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  } catch {}
}

console.log(failures === 0 ? "\nTEST 4 PASS" : `\nTEST 4 FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);