import { randomUUID } from "node:crypto";
import { hashPassword } from "@gchopro/core";
import { afterAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { closeDb, getDb } from "./client.js";
import {
  authenticateDevice,
  capacity,
  createPairing,
  recordHeartbeat,
  registerDevice,
  reportSims,
} from "./device-service.js";
import { closeRedis } from "./redis.js";
import { users } from "./schema.js";

describe("device simulator", () => {
  afterAll(async () => {
    await closeDb();
    await closeRedis();
  });

  it("pairs, reports two SIMs, heartbeats, and counts free slots", async () => {
    const db = getDb();
    const adminId = uuidv7();
    const username = `m2${adminId.split("-").join("").slice(0, 8)}`;
    await db.insert(users).values({
      id: adminId,
      role: "admin",
      username,
      displayName: "Device integration",
      passwordHash: await hashPassword("integration-password-1"),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      status: "active",
    });
    const actor = {
      userId: adminId,
      role: "admin",
      ip: "203.0.113.20",
      requestId: randomUUID(),
    };
    const pairing = await createPairing(actor, "Rack test");
    expect(pairing.code).toMatch(/^\d{6}$/);
    const registered = await registerDevice({
      code: pairing.code,
      name: "Rack test",
      protocolVersion: 2,
      appVersion: "2.0.0",
      model: "Infinix X6528",
      androidSdk: 34,
      ip: "203.0.113.21",
    });
    expect(registered.token).toMatch(/^[a-f0-9]{64}$/);
    const auth = await authenticateDevice(registered.id, registered.token);
    const reported = await reportSims(auth.device, {
      reportedAt: new Date().toISOString(),
      slotsOnDevice: 2,
      sims: [
        {
          subscriptionId: 3,
          slotIndex: 0,
          isEmbedded: false,
          carrierName: "Jazz",
          displayName: "SIM 1",
          mcc: "410",
          mnc: "01",
          countryIso: "pk",
          number: "+923001234567",
          simState: "SIM_STATE_READY",
          serviceState: "STATE_IN_SERVICE",
          signalLevel: 3,
        },
        {
          subscriptionId: 4,
          slotIndex: 1,
          isEmbedded: false,
          carrierName: "Zong",
          displayName: "SIM 2",
          mcc: "410",
          mnc: "04",
          countryIso: "pk",
          number: "",
          simState: "SIM_STATE_READY",
          serviceState: "OUT_OF_SERVICE",
          signalLevel: 0,
        },
      ],
    });
    expect(reported.sims).toHaveLength(2);
    const beat = await recordHeartbeat(auth.device, {
      battery: 76,
      charging: true,
      network: "wifi",
      appVersion: "2.0.0",
      androidSdk: 34,
      activeModemCount: 2,
    });
    expect(beat.paused).toBe(false);
    expect(beat.requestSimReport).toBe(false);
    const snapshot = await capacity();
    const device = snapshot.devices.find((item) => item.deviceId === registered.id);
    expect(device).toMatchObject({ slotsOnDevice: 2, activeSims: 2, assignedSims: 0, freeSims: 2 });
  });
});
