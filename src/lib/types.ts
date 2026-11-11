export type Phase = "work" | "grace" | "expired";

export interface CurfewState {
  /** Local ISO timestamp of the moment Windows goes down. */
  deadline: string;
  /** Human label for the deadline, e.g. "22:00". */
  deadlineLabel: string;
  /** Seconds until the countdown hits zero (0 once grace has started). */
  remainingSeconds: number;
  /** Size of the grace window in seconds. */
  graceSeconds: number;
  /** Seconds left in grace; only meaningful while phase === "grace". */
  graceRemainingSeconds: number;
  phase: Phase;
  /** Length of the whole countdown, for the progress bar. */
  totalSeconds: number;
  deadlineMinutes: number;
  graceMinutes: number;
  /** Grace windows borrowed tonight (Wait pressed during FINISH UP). */
  borrows: number;
  /** Minutes owed to tomorrow's earlier start. */
  owedMinutes: number;
  lockoutSeconds: number;
  released: boolean;
  dryRun: boolean;
  logPath: string;
}

export interface ReleaseResult {
  ok: boolean;
  lockoutSeconds: number;
  message: string;
}

export interface CurfewConfig {
  deadline: string;
  start: string;
  graceMinutes: number;
  batteryAllowed: boolean;
  wakeToRun: boolean;
  autostartConsole: boolean;
}

export interface LogSummary {
  timestamp: string;
  date: string;
  start: string;
  deadline: string;
  grace: string;
  borrows: number;
  released: boolean;
  outcome: string;
  raw: string;
}
