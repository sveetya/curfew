import type { CurfewConfig } from "./types";

/**
 * Does this edit touch the schedule?
 *
 * Moving the deadline is the thing the curfew exists to prevent, so the
 * backend demands the release key for exactly these fields. Toggles that do not
 * move the clock (battery, wake, autostart) save freely.
 */
export function scheduleDiffers(next: CurfewConfig, saved: CurfewConfig): boolean {
  return (
    next.deadline !== saved.deadline ||
    next.start !== saved.start ||
    next.graceMinutes !== saved.graceMinutes
  );
}

/** Fields whose change needs the key, for the UI's lock hint. */
export const LOCKED_FIELDS = ["start", "deadline", "graceMinutes"] as const;

/**
 * The schedule as one sentence.
 *
 * It doubles as live validation: "countdown 25 min, then grace 5 min" makes it
 * obvious that grace is carved out of the window rather than added on top,
 * which is the thing everybody gets wrong about this app.
 */
export function windowSentence(config: CurfewConfig): string {
  const start = toMinutes(config.start);
  const deadline = toMinutes(config.deadline);
  if (start === null || deadline === null) return "Set a card time and a shutdown time.";
  const window = (deadline - start + 24 * 60) % (24 * 60);
  if (window === 0) return "The card and the shutdown are the same moment.";
  const countdown = Math.max(0, window - config.graceMinutes);
  return `Countdown ${countdown} min, then grace ${config.graceMinutes} min. Shutdown at ${config.deadline}, no cancel.`;
}

function toMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
