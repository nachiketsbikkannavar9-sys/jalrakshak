import { config } from "../config.js";
import { prisma } from "../db/prisma.js";
import { CATEGORY_GUIDANCE, sanitizeRateOfRise, type RiskCategory } from "../../../shared/src/index.js";
import type { Station } from "@prisma/client";
import { deliver } from "./deliver.js";

/** Simple, honest email shape check (double @, whitespace, bare domain). */
export function isValidEmail(email: string): boolean {
  if (typeof email !== "string" || email.length > 254) return false;
  const e = email.trim();
  if (e !== email) return false;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return false;
  return !/\.\./.test(e.split("@")[1]);
}

export function unsubscribeUrl(sub: { unsubscribeToken: string }): string {
  return `${config.corsOrigin}/unsubscribe?token=${encodeURIComponent(sub.unsubscribeToken)}`;
}

export function subscriptionWatchLabel(sub: { regions: string[]; stationIds: string[] }): string {
  const parts: string[] = [];
  if (sub.regions.length) parts.push(...sub.regions);
  if (sub.stationIds.length) parts.push(`${sub.stationIds.length} station(s)`);
  return parts.length ? parts.join(", ") : "every alert";
}

/**
 * Plain-language citizen alert email body. One source of truth is the shared
 * CATEGORY_GUIDANCE action text; the numerical facts come from the actual
 * telemetry + stored thresholds (never invented).
 */
export function buildCitizenMessage(
  station: Station,
  reading: { level: number; riskScore: number; category: RiskCategory; rateOfRise: number | null; advisoryLevel?: string },
  sub: { unsubscribeToken: string; regions: string[]; stationIds: string[] }
): string {
  const guidance = CATEGORY_GUIDANCE[reading.category] ?? CATEGORY_GUIDANCE["No data"];
  const eyes = station.region ? station.region : "your area";
  const rate = sanitizeRateOfRise(reading.rateOfRise);
  const rateLine =
    rate != null && rate > 0
      ? `The level is rising (+${rate.toFixed(3)} m/h).`
      : "The level is steady or falling right now.";
  const aboveNormal = Math.max(0, reading.level - station.normalLevel);
  const positionLine =
    aboveNormal > 0
      ? `It is ${aboveNormal.toFixed(2)} ${station.unit} above the normal baseline (${station.normalLevel} ${station.unit}).`
      : `It is at/under the normal baseline (${station.normalLevel} ${station.unit}).`;
  return (
    `JALRAKSHAK CITIZEN ALERT — ${reading.category.toUpperCase()} (${reading.riskScore}/100)\n` +
    `Station: ${station.name} (${station.place}) · ${eyes}\n` +
    `Level now: ${reading.level} ${station.unit} · normal ${station.normalLevel} · warning ${station.warningLevel} · danger ${station.dangerLevel} ${station.unit}\n` +
    `${positionLine} ${rateLine}\n` +
    `What to do: ${guidance.action}\n` +
    `──\n` +
    `This is a Jalrakshak demo notification and is NOT an official NDMA/NDRF alert.\n` +
    `Manage these emails: ${unsubscribeUrl(sub)}`
  );
}

/**
 * After an authority Alert row is dispatched, notify matching citizen
 * subscriptions with a plain-language email. Only one automated citizen email
 * per station within the station's cooldown window (no spam).
 */
export async function notifyCitizens(
  station: Station,
  reading: { level: number; riskScore: number; category: RiskCategory; rateOfRise: number | null }
): Promise<number> {
  const subs = await prisma.emailSubscription.findMany();
  const cooldownMs = (station.alertCooldownMin || 30) * 60_000;
  let sent = 0;
  for (const sub of subs) {
    const watchesStation = sub.stationIds.includes(station.id);
    const watchesRegion = !!station.region && sub.regions.includes(station.region);
    if (!watchesStation && !watchesRegion) continue;
    const last = await prisma.citizenNotification.findFirst({
      where: { subscriptionId: sub.id, stationId: station.id },
      orderBy: { createdAt: "desc" },
    });
    if (last && Date.now() - new Date(last.createdAt).getTime() < cooldownMs) continue;
    const body = buildCitizenMessage(station, reading, sub);
    const subject = `River alert for your area: ${station.name} — ${reading.category}`;
    const outcome = await deliver("email", sub.email, subject, body);
    await prisma.citizenNotification.create({
      data: {
        subscriptionId: sub.id,
        stationId: station.id,
        level: reading.level,
        riskScore: reading.riskScore,
        category: reading.category,
        body,
        state: outcome.state,
        sentTo: sub.email,
      },
    });
    sent += 1;
    console.log(`[citizen] → ${sub.email} (${sub.regions.join(",") || sub.stationIds.length + " stations"}) · ${reading.category} · ${outcome.via}`);
  }
  return sent;
}