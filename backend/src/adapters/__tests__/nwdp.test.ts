import { describe, expect, it } from "vitest";
import { CATALOG, nwdpLevelBounds } from "../../adapters/nwdp.adapter.js";

describe("NWDP catalogue + level bounds (pure)", () => {
  it("has the 6 curated gauges with the correct thresholds", () => {
    expect(CATALOG).toHaveLength(6);
    const expectThresholds = (extId: string, normal: number, warning: number, danger: number) => {
      const seed = CATALOG.find((s) => s.externalId === extId);
      expect(seed?.normalLevel).toBeCloseTo(normal);
      expect(seed?.warningLevel).toBeCloseTo(warning);
      expect(seed?.dangerLevel).toBeCloseTo(danger);
    };
    expectThresholds("nwdp-bhadrachalam", 39.13, 42.93, 46.72);
    expectThresholds("nwdp-ambabal-narangi", 535.06, 535.71, 536.36);
    expectThresholds("nwdp-koida", 22.36, 23.01, 23.66);
    expectThresholds("nwdp-baisi-1", 33.39, 33.8, 34.2);
    expectThresholds("nwdp-arrah-chhapra-bridge", 45.07, 48.44, 51.8);
    expectThresholds("nwdp-nh15-crossing-fakirpara-tangni", 60.6, 61.11, 61.62);
  });

  it("regions feed the jurisdiction model", () => {
    const region = (extId: string) => CATALOG.find((s) => s.externalId === extId)?.region;
    expect(region("nwdp-arrah-chhapra-bridge")).toBe("Bihar");
    expect(region("nwdp-nh15-crossing-fakirpara-tangni")).toBe("Assam");
    expect(region("nwdp-bhadrachalam")).toBe("Telangana");
  });

  it("default bounds are [0, max(200, 3·danger)] and reject the known glitches", () => {
    const bhadra = nwdpLevelBounds("nwdp-bhadrachalam"); // danger 46.72
    expect(bhadra).toEqual({ min: 0, max: 200 });
    // the historical glitch row (262.48 m) is out of bounds
    expect(262.48 >= bhadra.min && 262.48 <= bhadra.max).toBe(false);
    const baisi = nwdpLevelBounds("nwdp-baisi-1"); // danger 34.2 → 3·34.2 = 102.6 → 200
    expect(baisi.max).toBe(200);
    expect(722.95 > baisi.max).toBe(true); // glitch rejected
  });

  it("highland gauge Ambabal keeps its explicit 500–570 envelope", () => {
    expect(nwdpLevelBounds("nwdp-ambabal-narangi")).toEqual({ min: 500, max: 570 });
  });

  it("unknown gauge falls back to a sane default", () => {
    const u = nwdpLevelBounds("nope");
    expect(u.min).toBe(0);
    expect(u.max).toBe(200);
  });
});