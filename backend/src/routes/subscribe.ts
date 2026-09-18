import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { prisma } from "../db/prisma.js";
import { deliver } from "../services/deliver.js";
import { isValidEmail, subscriptionWatchLabel, unsubscribeUrl } from "../services/citizenAlerts.js";

export const router = Router();

function toSubscriptionDTO(sub: {
  email: string;
  regions: string[];
  stationIds: string[];
  unsubscribeToken: string;
  createdAt: Date;
}) {
  return {
    email: sub.email,
    watching: subscriptionWatchLabel(sub),
    regions: sub.regions,
    stationIds: sub.stationIds,
    unsubscribeUrl: unsubscribeUrl(sub),
    createdAt: sub.createdAt.toISOString(),
  };
}

/**
 * No-login subscribe: an email + optional region(s)/station(s) to watch.
 * One row per email (upsert merges the watch lists). A token-based unsubscribe
 * link is returned and used in every citizen alert email.
 */
router.post("/", async (req: Request, res: Response) => {
  const { email: rawEmail, regions, stationIds } = req.body ?? {};
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!isValidEmail(email)) {
    res.status(400).json({ error: "a valid email address is required" });
    return;
  }
  const regs = Array.isArray(regions) ? regions.map(String).filter(Boolean) : [];
  const sids = Array.isArray(stationIds) ? stationIds.map(String).filter(Boolean) : [];

  // Sanity: reject watches that don't exist (caught misconfig, not silent).
  if (sids.length) {
    const known = await prisma.station.count({ where: { id: { in: sids } } });
    if (known !== sids.length) {
      res.status(400).json({ error: "one or more stationIds are unknown" });
      return;
    }
  }

  const existing = await prisma.emailSubscription.findUnique({ where: { email } });
  const sub = existing
    ? await prisma.emailSubscription.update({
        where: { email },
        data: {
          regions: { set: [...new Set([...existing.regions, ...regs])] },
          stationIds: { set: [...new Set([...existing.stationIds, ...sids])] },
        },
      })
    : await prisma.emailSubscription.create({
        data: {
          email,
          regions: regs,
          stationIds: sids,
          unsubscribeToken: crypto.randomUUID(),
        },
      });

  // Confirmation notice — delivered via the same honest demo channel.
  const subject = "Jalrakshak: you're subscribed to river alerts";
  await deliver(
    "email",
    email,
    subject,
    `You subscribed to Jalrakshak river alerts.\nWatching: ${subscriptionWatchLabel(sub)}\n\nManage these emails: ${unsubscribeUrl(sub)}\n\nThis is a hackathon demo — not an official NDMA/NDRF feed.`
  );

  res.status(201).json({ subscribed: true, subscription: toSubscriptionDTO(sub) });
});

/** Look up a subscription by its unsubscribe token (also powers the demo inbox). */
router.get("/", async (req, res: Response) => {
  const token = String(req.query.token ?? "");
  if (!token) {
    res.status(400).json({ error: "token required" });
    return;
  }
  const sub = await prisma.emailSubscription.findUnique({ where: { unsubscribeToken: token } });
  if (!sub) {
    res.status(404).json({ error: "subscription not found (already unsubscribed?)" });
    return;
  }
  const notifications = await prisma.citizenNotification.findMany({
    where: { subscriptionId: sub.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  res.json({ subscription: toSubscriptionDTO(sub), notifications });
});

/** Token-based unsubscribe — the link inside every citizen alert email. */
router.post("/unsubscribe", async (req, res: Response) => {
  const token = String((req.body ?? {}).token ?? req.query.token ?? "");
  if (!token) {
    res.status(400).json({ error: "token required" });
    return;
  }
  const sub = await prisma.emailSubscription.findUnique({ where: { unsubscribeToken: token } });
  if (!sub) {
    res.json({ unsubscribed: false, message: "no subscription found for that link (already removed?)." });
    return;
  }
  const email = sub.email;
  await prisma.emailSubscription.delete({ where: { id: sub.id } });
  res.json({ unsubscribed: true, email });
});