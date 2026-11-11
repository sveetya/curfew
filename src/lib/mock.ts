/**
 * Preview backend.
 *
 * Curfew's real logic lives in Rust (src-tauri/src/curfew.rs). When the
 * frontend is opened in a plain browser — `npm run dev` — there is no Tauri to
 * invoke, so this module answers the same calls with the same state machine in
 * TypeScript. It exists so the UI can be seen and styled without a Windows
 * machine; it never touches Windows, and the console says so on screen.
 */

import { clock, hhmm } from "./format";
import type { CurfewConfig, CurfewState, ReleaseResult } from "./types";

const PREVIEW_KEY = "curfew-preview-release";

function phaseOverride(): "work" | "grace" | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("phase");
  return value === "grace" ? "grace" : value === "work" ? "work" : null;
}

let config: CurfewConfig = {
  deadline: "22:00",
  start: "21:30",
  graceMinutes: 5,
  batteryAllowed: true,
  wakeToRun: true,
  autostartConsole: false,
  logDir: "",
};

let borrows = 0;
let lockoutUntil = 0;
let released = false;
let deadlineShiftMinutes = 0;
let startedAt = Date.now();

function deadlineDate(): Date {
  const [h, m] = config.deadline.split(":").map(Number);
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target.getTime() <= Date.now() - 1000 && phaseOverride() === null) {
    target.setDate(target.getDate() + 1);
  }
  return new Date(target.getTime() + deadlineShiftMinutes * 60_000);
}

export function previewState(): CurfewState {
  const deadline = deadlineDate();
  const graceSeconds = config.graceMinutes * 60;
  const totalMs = Math.max(60_000, deadline.getTime() - graceSeconds * 1000 - startedAt);
  const now = Date.now();
  const untilShutdown = Math.round((deadline.getTime() - now) / 1000);
  const override = phaseOverride();

  const remaining = override === "grace" ? 0 : Math.max(0, untilShutdown - graceSeconds);
  const phase: CurfewState["phase"] =
    remaining > 0 ? "work" : untilShutdown > 0 ? "grace" : "expired";

  return {
    deadline: deadline.toISOString(),
    deadlineLabel: hhmm(deadline),
    remainingSeconds: override === "grace" ? 0 : remaining,
    graceSeconds,
    graceRemainingSeconds: override === "grace" ? 182 : Math.max(0, untilShutdown),
    phase: override === "grace" ? "grace" : phase,
    totalSeconds: Math.round(totalMs / 1000),
    deadlineMinutes: Math.round(totalMs / 60_000),
    graceMinutes: config.graceMinutes,
    borrows,
    owedMinutes: borrows * 2,
    lockoutSeconds: Math.max(0, Math.round((lockoutUntil - now) / 1000)),
    released,
    dryRun: true,
    logPath: "preview: no log file on disk",
  };
}

export const mock = {
  getState: async () => previewState(),
  waitTen: async () => {
    const state = previewState();
    if (state.phase === "grace") borrows += 1;
    else deadlineShiftMinutes += 10;
    return previewState();
  },
  shutdownNow: async () => previewState(),
  requestRelease: async (key: string): Promise<ReleaseResult> => {
    if (previewState().lockoutSeconds > 0) {
      return {
        ok: false,
        lockoutSeconds: previewState().lockoutSeconds,
        message: "Still locked out.",
      };
    }
    const normalised = key.trim().toUpperCase().replace(/[\s-]/g, "");
    if (normalised === PREVIEW_KEY) {
      released = true;
      return { ok: true, lockoutSeconds: 0, message: "Released. Card closes." };
    }
    lockoutUntil = Date.now() + 5 * 60_000;
    return {
      ok: false,
      lockoutSeconds: 300,
      message: "Wrong key. Locked for 5 minutes.",
    };
  },
  readLog: async () =>
    [
      "PREVIEW LOG — the real audit log is written by the Rust side on Windows.",
      previewState().phase === "grace"
        ? `${new Date().toISOString().slice(0, 10)} 22:00:00  grace started in preview`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  getConfig: async () => config,
  setConfig: async (next: CurfewConfig, key?: string) => {
    const movesClock =
      next.deadline !== config.deadline ||
      next.start !== config.start ||
      next.graceMinutes !== config.graceMinutes;
    if (movesClock) {
      const normalised = (key ?? "").toUpperCase().replace(/[\s-]/g, "");
      if (normalised !== PREVIEW_KEY) {
        throw new Error("Preview: the schedule needs the release key to move.");
      }
    }
    config = next;
    borrows = 0;
    startedAt = Date.now();
    return config;
  },
  setAutostart: async (enabled: boolean) => {
    config = { ...config, autostartConsole: enabled };
    return config;
  },
  checkUpdate: async () => ({
    available: false,
    version: "0.1.1",
    notes: "Preview build: updates are checked on Windows only.",
  }),
  installUpdate: async () => false,
  /** Values the console displays in preview mode. */
  previewClock: () => clock(previewState().remainingSeconds),
};
