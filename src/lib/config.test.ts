import { describe, expect, it } from "vitest";
import { scheduleDiffers } from "./config";
import type { CurfewConfig } from "./types";

const saved: CurfewConfig = {
  deadline: "22:00",
  start: "21:30",
  graceMinutes: 5,
  batteryAllowed: true,
  wakeToRun: true,
  autostartConsole: false,
  logDir: "",
};

describe("scheduleDiffers", () => {
  it("is false for an identical config", () => {
    expect(scheduleDiffers({ ...saved }, saved)).toBe(false);
  });

  it("is true when the deadline moves", () => {
    expect(scheduleDiffers({ ...saved, deadline: "23:00" }, saved)).toBe(true);
  });

  it("is true when the card opens earlier", () => {
    expect(scheduleDiffers({ ...saved, start: "21:00" }, saved)).toBe(true);
  });

  it("is true when grace changes", () => {
    expect(scheduleDiffers({ ...saved, graceMinutes: 0 }, saved)).toBe(true);
  });

  it("is false when only the log folder changes", () => {
    expect(scheduleDiffers({ ...saved, logDir: "C:\\Users\\marek\\vault" }, saved)).toBe(false);
  });

  it("is false for toggles that do not move the clock", () => {
    expect(
      scheduleDiffers(
        { ...saved, batteryAllowed: false, wakeToRun: false, autostartConsole: true },
        saved,
      ),
    ).toBe(false);
  });
});
