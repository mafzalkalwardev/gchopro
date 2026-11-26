import { describe, expect, it } from "vitest";
import { detectLanguage } from "./detect.js";
import { translationApplies } from "./types.js";

describe("detectLanguage", () => {
  it("treats mostly Han text as Chinese and the rest as English", () => {
    expect(detectLanguage("你好世界")).toBe("zh");
    expect(detectLanguage("Hello there")).toBe("en");
    expect(detectLanguage("你好 Hello there friend")).toBe("en");
    expect(detectLanguage("你好你好你好 Hi")).toBe("zh");
    expect(detectLanguage("   ")).toBe("en");
  });
});

describe("translationApplies", () => {
  it("requires a provider, the user switch, and two different languages", () => {
    expect(
      translationApplies({
        provider: "deepl",
        enabled: true,
        userLanguage: "zh",
        recipientLanguage: "en",
      }),
    ).toBe(true);
    expect(
      translationApplies({
        provider: "none",
        enabled: true,
        userLanguage: "zh",
        recipientLanguage: "en",
      }),
    ).toBe(false);
    expect(
      translationApplies({
        provider: "libretranslate",
        enabled: true,
        userLanguage: "en",
        recipientLanguage: "en",
      }),
    ).toBe(false);
    expect(
      translationApplies({
        provider: "google",
        enabled: false,
        userLanguage: "zh",
        recipientLanguage: "en",
      }),
    ).toBe(false);
  });
});
