import { describe, expect, it } from "vitest";
import { shouldDispatchAlert } from "../alertDispatcher.js";
import { isNationalScope, stationInScope, scopeLabel, SCOPE_ALL } from "../../../../shared/src/index.js";

describe("shouldDispatchAlert (pure gate)", () => {
  it("dispatches only Warning+ regardless of channel targets", () => {
    expect(shouldDispatchAlert({ riskScore: 49, category: "Watch" })).toBe(false);
    expect(shouldDispatchAlert({ riskScore: 50, category: "Warning" })).toBe(true);
    expect(shouldDispatchAlert({ riskScore: 50, category: "Normal" })).toBe(false); // score gate not enough
    expect(shouldDispatchAlert({ riskScore: 87, category: "Severe" })).toBe(true);
    expect(shouldDispatchAlert({ riskScore: 88, category: "Critical" })).toBe(true);
    expect(shouldDispatchAlert({ riskScore: 0, category: "No data" })).toBe(false);
  });
});

describe("jurisdiction scope (shared helpers)", () => {
  const admin = { role: "admin", jurisdictionRegions: [] as string[], jurisdictionStationIds: [] as string[] };
  const assam = { role: "district_officer", jurisdictionRegions: ["Assam"], jurisdictionStationIds: [] as string[] };
  const stationId = "s-1";

  it("admin sees everything", () => {
    expect(isNationalScope(admin)).toBe(true);
    expect(stationInScope(admin, { id: stationId, region: "Bihar" })).toBe(true);
    expect(scopeLabel(admin)).toBe("national");
  });

  it("regional officer is scoped to their regions", () => {
    expect(isNationalScope(assam)).toBe(false);
    expect(stationInScope(assam, { id: stationId, region: "Assam" })).toBe(true);
    expect(stationInScope(assam, { id: stationId, region: "Bihar" })).toBe(false);
    // station without a region is out unless explicitly whitelisted
    expect(stationInScope(assam, { id: stationId, region: null })).toBe(false);
    expect(scopeLabel(assam)).toBe("Assam");
  });

  it("explicit station ids extend a regional scope; SCOPE_ALL means national", () => {
    const stationScoped = { role: "district_officer", jurisdictionRegions: [] as string[], jurisdictionStationIds: ["s-77"] };
    expect(stationInScope(stationScoped, { id: "s-77", region: "Odisha" })).toBe(true);
    expect(stationInScope(stationScoped, { id: "s-78", region: "Odisha" })).toBe(false);
    const wildcard = { role: "district_officer", jurisdictionRegions: [SCOPE_ALL], jurisdictionStationIds: [] as string[] };
    expect(isNationalScope(wildcard)).toBe(true);
  });

  it("anonymous (null) public callers are read-only national views", () => {
    expect(isNationalScope(null)).toBe(true);
    expect(stationInScope(undefined, { id: stationId, region: "Bihar" })).toBe(true);
  });
});