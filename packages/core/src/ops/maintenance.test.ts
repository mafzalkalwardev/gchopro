import { describe, expect, it } from "vitest";
import { maintenanceDue } from "./maintenance.js";

describe("maintenance schedule", () => {
  it("uses Asia/Karachi hours for backup, retention, and the Sunday restore test", () => {
    expect(maintenanceDue(new Date("2026-11-25T21:00:00.000Z"), "Asia/Karachi")).toMatchObject({
      day: "2026-11-26",
      backup: true,
      retention: false,
      restoreTest: false,
    });
    expect(maintenanceDue(new Date("2026-11-25T22:30:00.000Z"), "Asia/Karachi")).toMatchObject({
      day: "2026-11-26",
      retention: true,
      backup: false,
    });
    expect(maintenanceDue(new Date("2026-11-28T23:15:00.000Z"), "Asia/Karachi")).toMatchObject({
      day: "2026-11-29",
      restoreTest: true,
      backup: false,
      retention: false,
    });
    expect(maintenanceDue(new Date("2026-11-26T06:00:00.000Z"), "Asia/Karachi").backup).toBe(false);
  });
});
