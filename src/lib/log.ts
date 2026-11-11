import type { LogSummary } from "./types";

/**
 * Parser for Curfew's own audit log.
 *
 * The Rust side writes one narrative line per event and one machine line per
 * run:
 *   2026-11-11 22:00:07  SUMMARY  date=2026-11-11  start=21:30  deadline=22:00
 *     grace=300s  borrows=2  released=False  outcome=shutdown
 * The console reads the raw log and turns those lines into rows, so a log that
 * a human can read is also a table the app can count.
 */
const SUMMARY_RE =
  /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+SUMMARY\s+date=(\S+)\s+start=(\S+)\s+deadline=(\S+)\s+grace=(\S+)\s+borrows=(\d+)\s+released=(True|False|true|false)\s+outcome=(\S+)/;

export function parseSummaryLine(line: string): LogSummary | null {
  const match = SUMMARY_RE.exec(line.trim());
  if (!match) return null;
  return {
    timestamp: match[1],
    date: match[2],
    start: match[3],
    deadline: match[4],
    grace: match[5],
    borrows: Number(match[6]),
    released: match[7].toLowerCase() === "true",
    outcome: match[8],
    raw: line.trim(),
  };
}

/** All SUMMARY rows in a whole log, newest first. */
export function parseLog(text: string): LogSummary[] {
  const rows: LogSummary[] = [];
  for (const line of text.split(/\r?\n/)) {
    const row = parseSummaryLine(line);
    if (row) rows.push(row);
  }
  return rows.reverse();
}

/** Total borrowed grace windows in the last `days` runs. */
export function borrowedTotal(rows: LogSummary[]): number {
  return rows.reduce((sum, row) => sum + row.borrows, 0);
}
