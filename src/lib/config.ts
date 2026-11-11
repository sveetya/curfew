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
