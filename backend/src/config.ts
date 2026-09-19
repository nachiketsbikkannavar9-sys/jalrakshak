import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const dir = path.dirname(fileURLToPath(import.meta.url));
// cwd (backend/.env) wins over repo-root .env
dotenv.config();
dotenv.config({ path: path.resolve(dir, "../../.env") });
dotenv.config({ path: path.resolve(dir, "../.env") });

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}
function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === "1" || v.toLowerCase() === "true";
}
function list(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  if (!v) return fallback;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: num("PORT", 4000),
  publicApiBase: str("PUBLIC_API_BASE", "http://localhost:4000"),
  databaseUrl: str(
    "DATABASE_URL",
    "postgresql://postgres:postgres@127.0.0.1:55432/jalrakshak"
  ),
  autoStartPg: bool("AUTO_START_PG", true),
  jwtSecret: str("JWT_SECRET", "dev-secret-change-me"),
  jwtTtlHours: num("JWT_TTL_HOURS", 72),

  dataAdapters: list("DATA_ADAPTERS", ["ukEA", "demo", "nwdp"]),
  pollIntervalMin: num("POLL_INTERVAL_MIN", 2),
  stationRefreshHr: num("STATION_REFRESH_HR", 6),

  resendApiKey: str("RESEND_API_KEY", ""),
  alertEmailFrom: str("ALERT_EMAIL_FROM", "Jalrakshak Demo <demo@jalrakshak.local>"),
  twilioAccountSid: str("TWILIO_ACCOUNT_SID", ""),
  twilioAuthToken: str("TWILIO_AUTH_TOKEN", ""),
  twilioFrom: str("TWILIO_FROM", ""),

  // Demo recipients. SMS is OFF by default — there is no real phone number
  // yet, and an all-zero demo number can never be delivered. Add a real number
  // to ALERT_RECIPIENT_PHONES to re-enable the SMS channel.
  alertRecipientEmails: list(
    "ALERT_RECIPIENT_EMAILS",
    list("ALERT_RECIPIENTS", ["nachiketb588@gmail.com"])
  ),
  alertRecipientPhones: list("ALERT_RECIPIENT_PHONES", []),
  alertRecipientLabels: list("ALERT_RECIPIENT_LABELS", [
    "NDRF Control Room (Demo)",
  ]),

  authorityEmail: str("AUTHORITY_EMAIL", "ndrf@demo.local"),
  authorityPassword: str("AUTHORITY_PASSWORD", "ChangeMe123!"),
  authorityName: str("AUTHORITY_NAME", "NDRF Control Room (Demo)"),
  authorityRole: str("AUTHORITY_ROLE", "admin"),

  // Frontend origins allowed by CORS — comma-separated allow-list (Express +
  // Socket.IO). `corsOrigin` stays a single string for building public links
  // (e.g. the unsubscribe URL); `corsOrigins` is what the headers reflect.
  corsOrigin: str("CORS_ORIGIN", "http://localhost:5173"),
  corsOrigins: list("CORS_ORIGIN", ["http://localhost:5173"]),
} as const;

export const isEmbeddedLocalDb = config.databaseUrl.includes("127.0.0.1:55432");