import { describe, expect, it } from "vitest";
import { borrowedTotal, parseLog, parseSummaryLine } from "./log";

const clean =
  "2026-11-10 22:00:04  SUMMARY  date=2026-11-10  start=21:30  deadline=22:00  grace=300s  borrows=0  released=False  outcome=shutdown";
const borrowed =
  "2026-11-09 22:00:09  SUMMARY  date=2026-11-09  start=21:26  deadline=22:00  grace=300s  borrows=2  released=False  outcome=shutdown";
const released =
  "2026-11-08 23:14:51  SUMMARY  date=2026-11-08  start=21:30  deadline=22:00  grace=300s  borrows=1  released=True  outcome=released";

describe("parseSummaryLine", () => {
  it("reads a plain shutdown night", () => {
    const row = parseSummaryLine(clean);
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      date: "2026-11-10",
      start: "21:30",
      deadline: "22:00",
      grace: "300s",
      borrows: 0,
      released: false,
      outcome: "shutdown",
      timestamp: "2026-11-10 22:00:04",
    });
  });

  it("reads borrows as a number, not a string", () => {
    expect(parseSummaryLine(borrowed)?.borrows).toBe(2);
  });

  it("reads a release", () => {
    expect(parseSummaryLine(released)?.released).toBe(true);
  });

  it("tolerates CRLF and leading whitespace", () => {
    expect(parseSummaryLine(`  ${clean}\r`)).not.toBeNull();
  });

  it("ignores narrative lines", () => {
    expect(
      parseSummaryLine("2026-11-10 21:47:02  DEADLINE EXTENDED 10 min; new deadline 22:10:00"),
    ).toBeNull();
    expect(parseSummaryLine("")).toBeNull();
  });

  it("ignores a truncated summary", () => {
    expect(
      parseSummaryLine("2026-11-10 22:00:04  SUMMARY  date=2026-11-10  start=21:30"),
    ).toBeNull();
  });
});

describe("parseLog", () => {
  it("keeps only summaries, newest first", () => {
    const text = [
      "2026-11-10 21:30:00  started; deadline=22:00",
      clean,
      "2026-11-09 22:00:09  countdown reached zero; grace 300s started",
      borrowed,
      released,
      "",
    ].join("\r\n");
    const rows = parseLog(text);
    expect(rows).toHaveLength(3);
    expect(rows[0].date).toBe("2026-11-08");
    expect(rows[2].date).toBe("2026-11-10");
  });

  it("returns nothing for an empty log", () => {
    expect(parseLog("")).toEqual([]);
  });

  it("sums borrowed grace windows", () => {
    const rows = parseLog([clean, borrowed, released].join("\n"));
    expect(borrowedTotal(rows)).toBe(3);
  });
});
