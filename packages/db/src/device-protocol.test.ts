import { describe, expect, it } from "vitest";
import { registerDevice } from "./device-service.js";

describe("registerDevice", () => {
  it("rejects a v1 client before any lookup", async () => {
    await expect(
      registerDevice({
        code: "483920",
        name: "Old phone",
        protocolVersion: 1,
        appVersion: "1.0.0",
        model: "Old",
        androidSdk: 28,
        ip: "203.0.113.22",
      }),
    ).rejects.toMatchObject({ status: 426, code: "upgrade_required" });
  });
});
