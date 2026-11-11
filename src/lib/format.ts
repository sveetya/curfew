/**
 * Clock formatting for the countdown card.
 *
 * The card shows hours only when there really are hours left, so the common
 * "16:42" is not padded into "00:16:42" — at night the number you glance at
 * should be the number of minutes you still have.
 */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

/** "22:00" from a Date, in the machine's local zone. */
export function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

/** Progress bar fill: 100% at the start of the night, 0% at zero. */
export function percentLeft(remaining: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const pct = (remaining / total) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** Parse "HH:mm" into minutes since midnight, or null when malformed. */
export function parseHHmm(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** One-line description of a phase, used under the clock. */
export function phaseLabel(phase: "work" | "grace" | "expired"): string {
  if (phase === "work") return "until shutdown";
  if (phase === "grace") return "grace ends at shutdown";
  return "shutting down";
}
