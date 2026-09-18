import { describe, expect, it } from "vitest";
import type { Station } from "@prisma/client";
import { buildCitizenMessage, isValidEmail, subscriptionWatchLabel, unsubscribeUrl } from "../citizenAlerts.js";

const station = {
  name: "Mahanadi at Naraj",
  place: "Cuttack, Odisha",
  region: "Odisha",
  unit: "m",
  normalLevel: 19,
  warningLevel: 21.5,
  dangerLevel: 22.5,
} as unknown as Station;

const sub = { unsubscribeToken: "tok-123", regions: ["Odisha"], stationIds: [] };

describe("isValidEmail", () => {
  it("accepts real addresses and rejects malformed ones", () => {
    expect(isValidEmail("naresh@example.com")).toBe(true);
    expect(isValidEmail(" a@b.co")).toBe(false); // leading space
    expect(isValidEmail("no-at-sign")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false); // no domain suffix
    expect(isValidEmail("a@b..com")).toBe(false); // double dot
  });
});

describe("subscriptionWatchLabel / unsubscribeUrl", () => {
  it("describes the watch scope honestly", () => {
    expect(subscriptionWatchLabel(sub)).toBe("Odisha");
    expect(subscriptionWatchLabel({ regions: [], stationIds: ["a", "b"] })).toBe("2 station(s)");
    expect(subscriptionWatchLabel({ regions: [], stationIds: [] })).toBe("every alert");
  });

  it("links to the frontend unsubscribe route", () => {
    expect(unsubscribeUrl(sub)).toContain("/unsubscribe?token=tok-123");
  });
});

describe("buildCitizenMessage", () => {
  it("is plain language with thresholds, honest demo note and unsubscribe link", () => {
    const msg = buildCitizenMessage(station, { level: 22, riskScore: 72, category: "Severe", rateOfRise: 0.4 }, sub);
    expect(msg).toContain("JALRAKSHAK CITIZEN ALERT — SEVERE (72/100)");
    expect(msg).toContain("normal 19 · warning 21.5 · danger 22.5 m");
    expect(msg).toContain("Move valuables to higher ground"); // guidance action text
    expect(msg).toContain("NOT an official NDMA/NDRF alert");
    expect(msg).toContain("/unsubscribe?token=tok-123");
  });

  it("states when the level is at/below baseline instead of inventing risk", () => {
    const msg = buildCitizenMessage(station, { level: 18, riskScore: 0, category: "Normal", rateOfRise: null }, sub);
    expect(msg).toContain("NORMAL (0/100)");
    expect(msg).toContain("at/under the normal baseline");
  });
});