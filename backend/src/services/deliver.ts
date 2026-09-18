import { config } from "../config.js";

/**
 * Send one SMS/email. Without provider keys this logs to the console and is
 * still persisted as "logged-console" — an honest demo channel, never a fake
 * "delivered".
 */
export async function deliver(
  channel: "sms" | "email",
  to: string,
  subject: string,
  body: string
): Promise<{ delivered: boolean; via: string; state: "delivered" | "logged-console" | "failed" }> {
  if (channel === "email" && config.resendApiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: config.alertEmailFrom, to: [to], subject, text: body }),
      });
      return {
        delivered: res.ok,
        via: `resend${res.ok ? "" : ` (HTTP ${res.status})`}`,
        state: res.ok ? "delivered" : "failed",
      };
    } catch {
      return { delivered: false, via: "resend-error", state: "failed" };
    }
  }
  if (channel === "sms" && config.twilioAccountSid && config.twilioAuthToken && config.twilioFrom) {
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ From: config.twilioFrom, To: to, Body: body }).toString(),
        }
      );
      return {
        delivered: res.ok,
        via: `twilio${res.ok ? "" : ` (HTTP ${res.status})`}`,
        state: res.ok ? "delivered" : "failed",
      };
    } catch {
      return { delivered: false, via: "twilio-error", state: "failed" };
    }
  }
  // No provider keys configured: the dispatch is logged to the console and kept
  // in the app outbox/feed, but no real carrier is involved. Honest label —
  // NOT "delivered".
  console.log(`[alert:${channel}] → ${to}\n${body}\n`);
  return { delivered: false, via: "console-demo", state: "logged-console" };
}