import { describe, expect, it } from "vitest";
import { scheduleDiffers, windowSentence } from "./config";
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

describe("windowSentence", () => {
  it("carves grace out of the window", () => {
    expect(windowSentence(saved)).toBe(
      "Countdown 25 min, then grace 5 min. Shutdown at 22:00, no cancel.",
    );
  });

  it("handles a window that crosses midnight", () => {
    expect(windowSentence({ ...saved, start: "23:30", deadline: "00:30" })).toContain(
      "Countdown 55 min",
    );
  });

  it("says so when the times are unreadable", () => {
    expect(windowSentence({ ...saved, start: "9:5" })).toBe("Set a card time and a shutdown time.");
  });

  it("says so when both times are the same", () => {
    expect(windowSentence({ ...saved, start: "22:00" })).toContain(
      "The card and the shutdown are the same moment.",
    );
  });
});
