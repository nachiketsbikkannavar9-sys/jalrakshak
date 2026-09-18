import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pg_ctl, initdb } from "@embedded-postgres/linux-x64";
import pg from "pg";
import { config } from "../config.js";

const execFileP = promisify(execFile);

/**
 * Embedded PostgreSQL for zero-setup local demos (no Docker / no root).
 * Real PostgreSQL 18 binaries ship in node_modules (@embedded-postgres) and
 * run on 127.0.0.1:55432. In production set DATABASE_URL to Neon/Railway/
 * Supabase and AUTO_START_PG=0.
 *
 * We drive the binaries directly (initdb + pg_ctl) rather than via the
 * embedded-postgres wrapper so the daemon detaches and the parent process can
 * exit/restart cleanly.
 */
export const EMBEDDED_PORT = 55432;
export const EMBEDDED_DIR = path.resolve(
  path.dirname(path.dirname(new URL(import.meta.url).pathname)),
  ".pgdata"
);

let startedByUs = false;

function parsed(): { host: string; port: number; user: string; db: string } {
  const u = new URL(config.databaseUrl);
  return {
    host: u.hostname,
    port: Number(u.port || EMBEDDED_PORT),
    user: u.username || "postgres",
    db: u.pathname.replace(/^\//, "") || "postgres",
  };
}

async function canConnect(): Promise<boolean> {
  const p = parsed();
  const client = new pg.Client({
    host: p.host,
    port: p.port,
    user: p.user,
    database: p.db,
    connectionTimeoutMillis: 2500,
  });
  try {
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function ensureDatabase(): Promise<void> {
  const p = parsed();
  const client = new pg.Client({
    host: p.host,
    port: p.port,
    user: p.user,
    database: "postgres",
    connectionTimeoutMillis: 3000,
  });
  await client.connect();
  try {
    const res = await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [p.db]);
    if (res.rowCount === 0) {
      await client.query(`CREATE DATABASE "${p.db.replace(/"/g, '""')}"`);
      console.log(`[db] created database "${p.db}"`);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Bring the embedded PostgreSQL up (daemonized), then make sure the DB exists. */
export async function ensureEmbeddedPostgres(): Promise<boolean> {
  if (await canConnect()) {
    console.log(`[db] postgres already running on ${parsed().host}:${parsed().port}`);
    return true;
  }
  fs.mkdirSync(EMBEDDED_DIR, { recursive: true });
  const pgVersionFile = path.join(EMBEDDED_DIR, "PG_VERSION");

  if (!fs.existsSync(pgVersionFile)) {
    console.log(`[db] initializing postgres data dir (${EMBEDDED_DIR})…`);
    const { stderr } = await execFileP(
      initdb,
      ["--pgdata", EMBEDDED_DIR, "--auth", "trust", "--username", "postgres", "--no-locale", "--encoding", "UTF8"],
      { maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_MESSAGES: "C" } }
    );
    console.log(`[db] initdb ok · ${stderr.slice(-160).replace(/\n/g, " ").trim()}`);
  }

  const logFile = path.join(EMBEDDED_DIR, "postgres.log");
  try {
    await execFileP(
      pg_ctl,
      ["-D", EMBEDDED_DIR, "-l", logFile, "-o", `-p ${parsed().port} -h 127.0.0.1`, "-w", "start"],
      { maxBuffer: 4 * 1024 * 1024 }
    );
    startedByUs = true;
  } catch {
    // Maybe it came up between our check and this call.
    if (!(await canConnect())) throw new Error("embedded postgres failed to start (see " + logFile + ")");
  }
  console.log(`[db] embedded postgres up on 127.0.0.1:${parsed().port}`);
  await ensureDatabase();
  return true;
}

/** Stop the embedded postgres if and only if this process started it. */
export async function stopEmbeddedPostgres(): Promise<void> {
  if (!startedByUs) return;
  try {
    await execFileP(pg_ctl, ["-D", EMBEDDED_DIR, "-m", "fast", "-w", "stop"], { maxBuffer: 1 * 1024 * 1024 });
    console.log("[db] embedded postgres stopped");
  } catch (err) {
    console.warn("[db] stop warning:", (err as Error).message.slice(0, 120));
  }
}