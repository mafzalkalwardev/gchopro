import { describe, expect, it } from "vitest";
import {
  alertText,
  batteryLowOpen,
  batteryLowResolved,
  deviceOfflineDecision,
  maskNumber,
  renotifyDue,
} from "./decide.js";

const now = new Date("2026-11-26T12:00:00.000Z");

describe("device and battery alerts", () => {
  it("opens an offline alert after the grace and raises it after 15 minutes", () => {
    const recent = deviceOfflineDecision({
      lastHeartbeatAt: new Date("2026-11-26T11:58:00.000Z"),
      now,
      offlineAfterSeconds: 90,
    });
    expect(recent.open).toBe(false);
    const warning = deviceOfflineDecision({
      lastHeartbeatAt: new Date("2026-11-26T11:56:00.000Z"),
      now,
      offlineAfterSeconds: 90,
    });
    expect(warning).toEqual({ open: true, severity: "warning" });
    const critical = deviceOfflineDecision({
      lastHeartbeatAt: new Date("2026-11-26T11:40:00.000Z"),
      now,
      offlineAfterSeconds: 90,
    });
    expect(critical.severity).toBe("critical");
  });

  it("opens a low battery and resolves it when charging or five points higher", () => {
    expect(batteryLowOpen({ battery: 10, charging: false, threshold: 20 })).toBe(true);
    expect(batteryLowOpen({ battery: 10, charging: null, threshold: 20 })).toBe(true);
    expect(batteryLowOpen({ battery: 10, charging: true, threshold: 20 })).toBe(false);
    expect(batteryLowResolved({ battery: 10, charging: true, threshold: 20 })).toBe(true);
    expect(batteryLowResolved({ battery: 25, charging: false, threshold: 20 })).toBe(true);
    expect(batteryLowResolved({ battery: 22, charging: false, threshold: 20 })).toBe(false);
  });

  it("renotifies an open critical alert at most once an hour and masks numbers", () => {
    expect(
      renotifyDue({
        severity: "critical",
        lastNotifiedAt: new Date("2026-11-26T11:30:00.000Z"),
        now,
      }),
    ).toBe(false);
    expect(
      renotifyDue({
        severity: "critical",
        lastNotifiedAt: new Date("2026-11-26T10:00:00.000Z"),
        now,
      }),
    ).toBe(true);
    expect(renotifyDue({ severity: "warning", lastNotifiedAt: now, now })).toBe(false);
    expect(maskNumber("+923001234567")).toBe("+923****4567");
    expect(
      alertText({ title: "SIM may be suspended", type: "sim_suspected_suspended" }),
    ).not.toMatch(/\+923/u);
  });
});
