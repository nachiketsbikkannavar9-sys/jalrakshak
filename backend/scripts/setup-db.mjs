#!/usr/bin/env node
// Boot the embedded PostgreSQL (daemonized) + create the app database.
// Then run: prisma db push
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pg_ctl, initdb } from "@embedded-postgres/linux-x64";
import pg from "pg";

const PORT = 55432;
const DB = "jalrakshak";
const DIR = path.resolve(new URL("../.pgdata", import.meta.url).pathname);
const execFileP = promisify(execFile);
const log = (...a) => console.log("[db]", ...a);

async function main() {
  const probe = new pg.Client({ host: "127.0.0.1", port: PORT, user: "postgres", database: DB, connectionTimeoutMillis: 1500 });
  try {
    await probe.connect();
    log(`postgres already running on :${PORT}`);
    await probe.end();
    return;
  } catch {
    /* not running yet */
  }

  fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(path.join(DIR, "PG_VERSION"))) {
    log("initializing data dir…");
    await execFileP(
      initdb,
      ["--pgdata", DIR, "--auth", "trust", "--username", "postgres", "--no-locale", "--encoding", "UTF8"],
      { maxBuffer: 4 * 1024 * 1024 }
    );
  }
  await execFileP(pg_ctl, ["-D", DIR, "-l", path.join(DIR, "postgres.log"), "-o", `-p ${PORT} -h 127.0.0.1`, "-w", "start"], {
    maxBuffer: 4 * 1024 * 1024,
  });
  log(`up on 127.0.0.1:${PORT}`);

  const admin = new pg.Client({ host: "127.0.0.1", port: PORT, user: "postgres", database: "postgres" });
  await admin.connect();
  const res = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB]);
  if (res.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${DB}"`);
    log(`created database "${DB}"`);
  }
  await admin.end();
}

main().catch((e) => {
  console.error("[db] setup failed:", e);
  process.exit(1);
});