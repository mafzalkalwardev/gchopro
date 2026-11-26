import { describe, expect, it } from "vitest";
import { parseSetting, publicSettingValue, sudoRequiredForSetting } from "./schema.js";

describe("settings", () => {
  it("accepts the seeded translation document and hides provider secrets", () => {
    const value = parseSetting("translation", {
      provider: "none",
      deepl: { plan: "free", authKey: "secret-key" },
      google: {},
      libretranslate: { url: null },
      preview_before_send: true,
    });
    expect(sudoRequiredForSetting("translation")).toBe(true);
    expect(sudoRequiredForSetting("branding")).toBe(false);
    expect(publicSettingValue("translation", value)).toMatchObject({
      provider: "none",
      deepl: { plan: "free", authKeyConfigured: true },
    });
  });

  it("rejects a gap floor below 5 seconds", () => {
    expect(() => parseSetting("min_gap_floor_seconds", 4)).toThrow();
    expect(parseSetting("min_gap_floor_seconds", 5)).toBe(5);
  });
});
