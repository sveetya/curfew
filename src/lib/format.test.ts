import { describe, expect, it } from "vitest";
import { clock, hhmm, parseHHmm, percentLeft, phaseLabel } from "./format";

describe("clock", () => {
  it("shows minutes and seconds under an hour", () => {
    expect(clock(0)).toBe("00:00");
    expect(clock(59)).toBe("00:59");
    expect(clock(2835)).toBe("47:15");
  });

  it("adds hours only when there are hours", () => {
    expect(clock(3600)).toBe("1:00:00");
    expect(clock(9 * 3600 + 4 * 60 + 7)).toBe("9:04:07");
  });

  it("never renders a negative number", () => {
    expect(clock(-12)).toBe("00:00");
  });

  it("does not round up into the next minute", () => {
    expect(clock(59.9)).toBe("00:59");
  });
});

describe("percentLeft", () => {
  it("is full at the start and empty at zero", () => {
    expect(percentLeft(1800, 1800)).toBe(100);
    expect(percentLeft(0, 1800)).toBe(0);
  });

  it("clamps instead of overflowing the track", () => {
    expect(percentLeft(2000, 1800)).toBe(100);
    expect(percentLeft(-5, 1800)).toBe(0);
  });

  it("survives a zero total", () => {
    expect(percentLeft(10, 0)).toBe(0);
  });
});

describe("times", () => {
  it("formats a date as HH:mm", () => {
    expect(hhmm(new Date(2026, 10, 11, 22, 0))).toBe("22:00");
    expect(hhmm(new Date(2026, 10, 11, 21, 5))).toBe("21:05");
  });

  it("parses 24h input", () => {
    expect(parseHHmm("21:30")).toBe(1290);
    expect(parseHHmm("00:00")).toBe(0);
  });

  it("rejects malformed input", () => {
    expect(parseHHmm("24:00")).toBeNull();
    expect(parseHHmm("9:5")).toBeNull();
    expect(parseHHmm("")).toBeNull();
  });

  it("labels the phases", () => {
    expect(phaseLabel("work")).toContain("until shutdown");
    expect(phaseLabel("grace")).toContain("grace");
    expect(phaseLabel("expired")).toBe("shutting down");
  });
});
