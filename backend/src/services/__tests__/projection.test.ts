import { describe, expect, it } from "vitest";
import { PROJECTION_HORIZON_H, projectThresholds, fmtProjectionHours } from "../projection.js";

describe("projectThresholds (linear extrapolation)", () => {
  it("estimates hours to warning and danger from the current rate", () => {
    const p = projectThresholds({ level: 45, warningLevel: 50, dangerLevel: 60, riseRateH: 1 });
    expect(p).not.toBeNull();
    expect(p!.hoursToWarning).toBeCloseTo(5);
    expect(p!.hoursToDanger).toBeCloseTo(15);
  });

  it("returns null when the level is already past warning (warning=null comes from cappedHours)", () => {
    const p = projectThresholds({ level: 55, warningLevel: 50, dangerLevel: 60, riseRateH: 1 });
    expect(p!.hoursToWarning).toBeNull();
    expect(p!.hoursToDanger).toBeCloseTo(5);
  });

  it("returns null for non-positive or missing rate (genuinely no estimate)", () => {
    expect(projectThresholds({ level: 45, warningLevel: 50, dangerLevel: 60, riseRateH: null })).toBeNull();
    expect(projectThresholds({ level: 45, warningLevel: 50, dangerLevel: 60, riseRateH: 0 })).toBeNull();
    expect(projectThresholds({ level: 45, warningLevel: 50, dangerLevel: 60, riseRateH: -2 })).toBeNull();
  });

  it("caps at the horizon and never fabricates a crossing beyond it", () => {
    const slow = projectThresholds({ level: 45, warningLevel: 50, dangerLevel: 60, riseRateH: 0.00001 });
    expect(slow).not.toBeNull();
    const hoursToDanger = (60 - 45) / 0.00001; // 15,000,000h > horizon
    expect(hoursToDanger > PROJECTION_HORIZON_H).toBe(true);
    expect(slow!.hoursToDanger).toBeNull();
  });
});

describe("fmtProjectionHours", () => {
  it("formats compactly and never prints a fabricated value", () => {
    expect(fmtProjectionHours(3.5)).toBe("3h 30m");
    expect(fmtProjectionHours(0.25)).toBe("15m");
    expect(fmtProjectionHours(NaN)).toBe("—");
  });
});