import { config } from "../config.js";
import { prisma } from "../db/prisma.js";
import { emit } from "../socket.js";
import type { AlertDTO, RiskCategory } from "../../../shared/src/index.js";
import { sanitizeRateOfRise } from "../../../shared/src/index.js";
import type { Station } from "@prisma/client";
import { fmtProjectionHours, projectThresholds } from "./projection.js";
import { notifyCitizens } from "./citizenAlerts.js";
import { deliver } from "./deliver.js";

/** The configured demo recipient list (team member / judge "NDRF control room"). */
export async function recipientList(): Promise<{ contacts: { name: string; role: string; channel: "sms" | "email"; address: string }[] }> {
  const contacts: { name: string; role: string; channel: "sms" | "email"; address: string }[] = [];
  config.alertRecipientEmails.forEach((address, i) =>
    contacts.push({
      name: config.alertRecipientLabels[i] ?? "Demo Officer",
      role: "NDRF/DDMA demo list",
      channel: "email" as const,
      address,
    })
  );
  config.alertRecipientPhones.forEach((address, i) =>
    contacts.push({
      name: config.alertRecipientLabels[config.alertRecipientEmails.length + i] ?? "Demo SMSC",
      role: "NDRF/DDMA demo list",
      channel: "sms" as const,
      address,
    })
  );
  return { contacts };
}

function buildMessage(
  station: Station,
  level: number,
  riskScore: number,
  category: RiskCategory,
  rateOfRise: number | null
): string {
  // Same symmetric plausibility floor as the risk engine — a floored rate
  // must never print as a huge number in an alert body.
  const rate = sanitizeRateOfRise(rateOfRise);
  const rateLine = rate != null ? ` | rise ${rate >= 0 ? "+" : ""}${rate} m/h` : "";
  // "still rising, ~Xh to danger level" — the single most useful line for a
  // responder. Linear extrapolation from the current rate, honestly labelled.
  const proj = projectThresholds({
    level,
    warningLevel: station.warningLevel,
    dangerLevel: station.dangerLevel,
    riseRateH: rate,
  });
  const projLine =
    proj != null && proj.hoursToDanger != null
      ? `Still rising — ~${fmtProjectionHours(proj.hoursToDanger)} to danger level (linear estimate).`
      : "";
  return (
    `JALRAKSHAK FLOOD ALERT — ${category.toUpperCase()} (${riskScore}/100)\n` +
    `Station: ${station.name} (${station.place})\n` +
    `Level: ${level} ${station.unit}${rateLine}\n` +
    `Thresholds: warning ${station.warningLevel} / danger ${station.dangerLevel} ${station.unit}\n` +
    (projLine ? `${projLine}\n` : "") +
    `──\nSent to a DEMO distribution list (not NDRF/NDMA). Acknowledge in the Jalrakshak authority console.`
  );
}

/** Pure gate shared by the dispatcher + tests: is this reading alert-worthy? */
export function shouldDispatchAlert(reading: { riskScore: number; category: string }): boolean {
  return reading.riskScore >= 50 && ["Warning", "Severe", "Critical"].includes(reading.category);
}

/**
 * Called after new readings are ingested. If a station crossed the Warning
 * threshold and is outside its cooldown window, dispatch SMS/email to the
 * configured demo recipients and persist an Alert row per recipient.
 */
export async function maybeAlertForStation(
  station: Station,
  reading: { riskScore: number; category: string; level: number; rateOfRise: number | null }
): Promise<AlertDTO[]> {
  if (!shouldDispatchAlert(reading)) {
    return [];
  }
  const last = await prisma.alert.findFirst({
    where: { stationId: station.id },
    orderBy: { createdAt: "desc" },
  });
  const cooldownMs = (station.alertCooldownMin || 30) * 60_000;
  if (last && Date.now() - new Date(last.createdAt).getTime() < cooldownMs) {
    console.log(`[alerts] ${station.name} in cooldown, skip`);
    return [];
  }

  const recips = await recipientList();
  const subject = `Flood alert: ${station.name} — ${reading.category}`;
  const body = buildMessage(station, reading.level, reading.riskScore, reading.category as RiskCategory, reading.rateOfRise);

  const targets: { channel: "sms" | "email"; to: string }[] = [
    ...recips.contacts.filter((c) => c.channel === "email").map((c) => ({ channel: "email" as const, to: c.address })),
    ...recips.contacts.filter((c) => c.channel === "sms").map((c) => ({ channel: "sms" as const, to: c.address })),
  ];

  const created: AlertDTO[] = [];
  for (const t of targets) {
    const outcome = await deliver(t.channel, t.to, subject, body);
    const row = await prisma.alert.create({
      data: {
        stationId: station.id,
        riskScore: reading.riskScore,
        category: reading.category,
        channel: t.channel,
        sentTo: t.to,
        body,
        delivered: outcome.delivered,
        deliveredVia: outcome.via.split(" ")[0],
        deliveryState: outcome.state,
        level: reading.level,
        rateOfRise: reading.rateOfRise,
      },
    });
    const dto = toAlertDTO(row, station);
    created.push(dto);
    emit("alert:new", dto);
    console.log(`[alerts] ${t.channel} → ${t.to} via ${outcome.via} (score ${reading.riskScore}, ${reading.category})`);
  }

  // Citizen (public) subscribers watching this station/region get a
  // plain-language email — separate, cooldown-gated, clearly NOT an official alert.
  const citizensSent = await notifyCitizens(station, {
    ...reading,
    category: reading.category as RiskCategory,
  }).catch((err) => {
    console.error("[citizen] notify failed:", (err as Error).message);
    return 0;
  });
  if (citizensSent > 0) console.log(`[citizen] dispatched ${citizensSent} citizen notification(s) for ${station.name}`);

  return created;
}

export function toAlertDTO(
  row: {
    id: string;
    sentTo: string;
    channel: string;
    delivered: boolean;
    deliveredVia: string | null;
    deliveryState: string | null;
    createdAt: Date;
    acknowledgedAt: Date | null;
    acknowledgedBy: string | null;
    body: string;
    riskScore: number;
    category: string;
    level: number | null;
    rateOfRise: number | null;
  },
  station: Station
): AlertDTO {
  const proj =
    row.level != null
      ? projectThresholds({
          level: row.level,
          warningLevel: station.warningLevel,
          dangerLevel: station.dangerLevel,
          riseRateH: sanitizeRateOfRise(row.rateOfRise),
        })
      : null;
  const dto: AlertDTO = {
    id: row.id,
    stationId: station.id,
    stationName: station.name,
    place: station.place,
    kind: station.kind,
    riskScore: row.riskScore,
    category: row.category as RiskCategory,
    channel: row.channel as "sms" | "email",
    sentTo: row.sentTo,
    body: row.body,
    delivered: row.delivered,
    deliveredVia: row.deliveredVia ?? "console-demo",
    deliveryState:
      row.deliveryState === "delivered" || row.deliveryState === "logged-console" || row.deliveryState === "failed"
        ? row.deliveryState
        : row.delivered
          ? "delivered"
          : "logged-console",
    createdAt: row.createdAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    acknowledgedBy: row.acknowledgedBy,
    level: row.level ?? null,
    unit: station.unit,
    normalLevel: station.normalLevel,
    warningLevel: station.warningLevel,
    dangerLevel: station.dangerLevel,
    rateOfRise: sanitizeRateOfRise(row.rateOfRise) ?? null,
    projectionHoursToWarning: proj?.hoursToWarning ?? null,
    projectionHoursToDanger: proj?.hoursToDanger ?? null,
  };
  return dto;
}