import "dotenv/config";
import http from "node:http";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { ensureEmbeddedPostgres, stopEmbeddedPostgres } from "./db/embeddedPg.js";
import { prisma } from "./db/prisma.js";
import { seedAuthority } from "./services/auth.js";
import { syncService } from "./services/syncService.js";
import { startScheduler } from "./services/scheduler.js";
import { initIo, emit } from "./socket.js";
import { router as stationsRouter } from "./routes/stations.js";
import { router as alertsRouter } from "./routes/alerts.js";
import { router as authRouter } from "./routes/auth.js";
import { router as adminRouter } from "./routes/admin.js";
import { router as subscribeRouter } from "./routes/subscribe.js";
import { buildStationsDTO, nationalStats } from "./services/dto.js";

async function main() {
  const startedAt = Date.now();

  if (config.autoStartPg) {
    try {
      await ensureEmbeddedPostgres();
    } catch (err) {
      console.error("[db] embedded postgres failed to start — check DATABASE_URL / AUTO_START_PG:", (err as Error).message);
      process.exit(1);
    }
  }
  await prisma.$connect();
  await seedAuthority();

  const app = express();
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({
      app: "Jalrakshak API",
      version: "1.0.0",
      docs: "GET /api/stations, /api/alerts, /api/alerts/stats, /api/auth/*",
      live: new Date().toISOString(),
      uptimeMs: Date.now() - startedAt,
    });
  });

  app.use("/api/stations", stationsRouter);
  app.use("/api/alerts", alertsRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/subscribe", subscribeRouter);

  const server = http.createServer(app);
  initIo(server);
  server.listen(config.port, () => {
    console.log(`\n══════════════════════════════════════════`);
    console.log(`  Jalrakshak API  ·  http://localhost:${config.port}`);
    console.log(`  Socket.IO live updates on the same port`);
    console.log(`  ⏳ boot telemetry sync running in background…`);
    console.log(`══════════════════════════════════════════\n`);
  });

  // Boot-time sync: register stations + pull first readings so the dashboard
  // is never empty. Runs in the background — the API is up immediately.
  (async () => {
    try {
      await syncService.syncAll(true);
    } catch (err) {
      console.error("[boot] initial sync errors:", (err as Error).message);
    }
    const dto0 = await buildStationsDTO().catch(() => []);
    const stats0 = nationalStats(dto0);
    emit("app:boot", { stations: dto0, stats: stats0 });
    console.log(`[boot] telemetry synced · ${dto0.length} stations · national risk index ${stats0.nationalIndex}/100`);
  })();

  startScheduler();

  const shutdown = async () => {
    console.log("\n[server] shutting down…");
    await prisma.$disconnect().catch(() => undefined);
    await stopEmbeddedPostgres().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[server] fatal:", err);
  process.exit(1);
});