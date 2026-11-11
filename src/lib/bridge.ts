import { invoke } from "@tauri-apps/api/core";
import type { CurfewConfig, CurfewState, ReleaseResult } from "./types";
import { mock } from "./mock";

/**
 * One door between the UI and the backend.
 *
 * On Windows this is Tauri's invoke(); in a browser preview it is the
 * TypeScript twin in mock.ts. Components never check which one they are
 * talking to, so the card and the console render identically either way.
 */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface UpdateInfo {
  available: boolean;
  version: string;
  notes: string;
}

export const api = {
  getState: (): Promise<CurfewState> =>
    isTauri ? invoke<CurfewState>("get_state") : mock.getState(),

  waitTen: (): Promise<CurfewState> =>
    isTauri ? invoke<CurfewState>("wait_ten") : mock.waitTen(),

  shutdownNow: (): Promise<CurfewState> =>
    isTauri ? invoke<CurfewState>("shutdown_now") : mock.shutdownNow(),

  requestRelease: (key: string): Promise<ReleaseResult> =>
    isTauri
      ? invoke<ReleaseResult>("request_release", { key })
      : mock.requestRelease(key),

  readLog: (): Promise<string> =>
    isTauri ? invoke<string>("read_log") : mock.readLog(),

  getConfig: (): Promise<CurfewConfig> =>
    isTauri ? invoke<CurfewConfig>("get_config") : mock.getConfig(),

  setConfig: (next: CurfewConfig, key?: string): Promise<CurfewConfig> =>
    isTauri
      ? invoke<CurfewConfig>("set_config", { config: next, key: key ?? null })
      : mock.setConfig(next, key),

  setAutostart: (enabled: boolean): Promise<CurfewConfig> =>
    isTauri
      ? invoke<CurfewConfig>("set_autostart", { enabled })
      : mock.setAutostart(enabled),

  checkUpdate: async (): Promise<UpdateInfo> => {
    if (!isTauri) return mock.checkUpdate();
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { available: false, version: "", notes: "" };
    return { available: true, version: update.version, notes: update.body ?? "" };
  },

  getVersion: async (): Promise<string> => {
    if (!isTauri) return "0.1.1-preview";
    const { getVersion } = await import("@tauri-apps/api/app");
    return getVersion();
  },

  installUpdate: async (): Promise<boolean> => {
    if (!isTauri) return mock.installUpdate();
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return false;
    await update.downloadAndInstall();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
    return true;
  },
};
