import { describe, expect, it } from "vitest";
import { reconcileSims, type StoredSimIdentity } from "./reconcile.js";

const stored: StoredSimIdentity[] = [
  {
    id: "sim-a",
    subscriptionId: 3,
    slotIndex: 0,
    carrierName: "Jazz",
    phoneNumberHash: "hash-a",
    retired: false,
  },
  {
    id: "sim-b",
    subscriptionId: 4,
    slotIndex: 1,
    carrierName: "Zong",
    phoneNumberHash: null,
    retired: false,
  },
  {
    id: "sim-old",
    subscriptionId: 9,
    slotIndex: 0,
    carrierName: "Jazz",
    phoneNumberHash: "hash-old",
    retired: true,
  },
];

describe("reconcileSims", () => {
  it("matches by subscription and creates a new slot", () => {
    const plan = reconcileSims(stored, [
      { subscriptionId: 3, slotIndex: 0, carrierName: "Jazz", phoneNumberHash: "hash-a" },
      { subscriptionId: 8, slotIndex: 2, carrierName: "Ufone", phoneNumberHash: "hash-c" },
    ]);
    expect(plan.matched).toEqual([{ id: "sim-a", reportIndex: 0 }]);
    expect(plan.created).toEqual([1]);
    expect(plan.reactivated).toEqual([]);
    expect(plan.missing).toEqual(["sim-b"]);
  });

  it("reuses a retired row when the same number comes back", () => {
    const plan = reconcileSims(stored, [
      { subscriptionId: 11, slotIndex: 0, carrierName: "Jazz", phoneNumberHash: "hash-old" },
    ]);
    expect(plan.reactivated).toEqual([{ id: "sim-old", reportIndex: 0 }]);
    expect(plan.created).toEqual([]);
  });

  it("falls back to slot, carrier, and a known number when the subscription changes", () => {
    const plan = reconcileSims(stored, [
      { subscriptionId: 30, slotIndex: 0, carrierName: "Jazz", phoneNumberHash: "hash-a" },
    ]);
    expect(plan.matched).toEqual([{ id: "sim-a", reportIndex: 0 }]);
    expect(plan.missing).toEqual(["sim-b"]);
  });

  it("does not treat a blank number as an identity", () => {
    const plan = reconcileSims(stored, [
      { subscriptionId: 40, slotIndex: 1, carrierName: "Zong", phoneNumberHash: null },
    ]);
    expect(plan.matched).toEqual([]);
    expect(plan.created).toEqual([0]);
  });
});
