import { describe, expect, it } from "vitest";
import { classifyFailure } from "./classify.js";
import { evaluateHealth, type HealthInput } from "./machine.js";

const now = new Date("2026-11-25T10:00:00Z");

function input(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    deviceRetired: false,
    pausedByAdmin: false,
    activeOnDevice: true,
    simState: "SIM_STATE_READY",
    serviceState: "STATE_IN_SERVICE",
    signalLevel: 3,
    current: "active",
    consecutiveFailures: 0,
    suspensionSignals24h: 0,
    notReadySince: null,
    serviceOutSince: null,
    lastHeartbeatAt: new Date("2026-11-25T09:59:30Z"),
    now,
    consecutiveFailureThreshold: 3,
    suspensionSignalThreshold: 2,
    clearSuspension: false,
    ...overrides,
  };
}

describe("classifyFailure", () => {
  it("maps names and keeps a generic failure transient only in service", () => {
    expect(classifyFailure("RESULT_ERROR_NO_SERVICE")).toBe("sim_problem");
    expect(classifyFailure("RESULT_ERROR_LIMIT_EXCEEDED")).toBe("suspension_signal");
    expect(classifyFailure("RESULT_INVALID_SMS_FORMAT")).toBe("permanent");
    expect(classifyFailure("RESULT_ERROR_GENERIC_FAILURE", "STATE_IN_SERVICE")).toBe("transient");
    expect(classifyFailure("RESULT_ERROR_GENERIC_FAILURE", "OUT_OF_SERVICE")).toBe("sim_problem");
    expect(classifyFailure("SOMETHING_NEW")).toBe("unknown");
  });
});

describe("evaluateHealth", () => {
  it("follows the priority order", () => {
    expect(evaluateHealth(input({ deviceRetired: true, pausedByAdmin: true }))).toBe("retired");
    expect(evaluateHealth(input({ pausedByAdmin: true }))).toBe("paused_admin");
    expect(evaluateHealth(input({ activeOnDevice: false }))).toBe("inactive");
    expect(evaluateHealth(input({ simState: "SIM_STATE_ABSENT" }))).toBe("absent");
    expect(
      evaluateHealth(
        input({
          simState: "SIM_STATE_NOT_READY",
          notReadySince: new Date("2026-11-25T09:54:00Z"),
        }),
      ),
    ).toBe("absent");
    expect(evaluateHealth(input({ simState: "SIM_STATE_NOT_READY" }))).toBe("active");
    expect(evaluateHealth(input({ simState: "SIM_STATE_PIN_REQUIRED" }))).toBe("locked");
  });

  it("keeps a suspected suspension until an admin re-test clears it", () => {
    expect(evaluateHealth(input({ current: "suspected_suspended" }))).toBe("suspected_suspended");
    expect(evaluateHealth(input({ suspensionSignals24h: 2 }))).toBe("suspected_suspended");
    expect(evaluateHealth(input({ consecutiveFailures: 3 }))).toBe("suspected_suspended");
    expect(evaluateHealth(input({ current: "suspected_suspended", clearSuspension: true }))).toBe(
      "active",
    );
  });

  it("marks no_service after two minutes and error when the handset stays offline", () => {
    expect(
      evaluateHealth(
        input({
          serviceState: "OUT_OF_SERVICE",
          serviceOutSince: new Date("2026-11-25T09:57:00Z"),
        }),
      ),
    ).toBe("no_service");
    expect(evaluateHealth(input({ serviceState: "OUT_OF_SERVICE" }))).toBe("active");
    expect(
      evaluateHealth(
        input({
          serviceState: "OUT_OF_SERVICE",
          consecutiveFailures: 3,
        }),
      ),
    ).toBe("error");
    expect(evaluateHealth(input({ lastHeartbeatAt: new Date("2026-11-25T09:40:00Z") }))).toBe(
      "error",
    );
  });
});
