import { describe, expect, it } from "vitest";
import { fmtLevel, fmtProjHours, fmtRelative, fmtRise, fmtNum } from "../format";

describe("format helpers", () => {
  it("fmtLevel renders null as em-dash (never a made-up number)", () => {
    expect(fmtLevel(null)).toBe("—");
    expect(fmtLevel(52.5, "m")).toBe("52.50 m");
  });

  it("fmtRise signs rising/falling explicitly", () => {
    expect(fmtRise(0.4)).toBe("+0.400 m/h");
    expect(fmtRise(-0.25)).toBe("−0.250 m/h");
    expect(fmtRise(null)).toBe("—");
  });

  it("fmtProjHours is compact and honest", () => {
    expect(fmtProjHours(3.5)).toBe("3h 30m");
    expect(fmtProjHours(0.25)).toBe("15m");
    expect(fmtProjHours(NaN)).toBe("—");
  });

  it("fmtNum tolerates garbage", () => {
    expect(fmtNum(undefined)).toBe("—");
    expect(fmtNum(2.456)).toBe("2.46");
  });

  it("fmtRelative never reports a future time as negative", () => {
    expect(fmtRelative(new Date(Date.now() - 7 * 60_000).toISOString())).toBe("7m ago");
  });
});