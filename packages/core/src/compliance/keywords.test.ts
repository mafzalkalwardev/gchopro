import { describe, expect, it } from "vitest";
import { confirmationLanguage, matchingKeyword } from "./keywords.js";

const optOut = ["STOP", "UNSUBSCRIBE", "退订"];
const optIn = ["START", "订阅"];

describe("matchingKeyword", () => {
  it("matches a whole keyword and a keyword followed by space or punctuation", () => {
    expect(matchingKeyword(" STOP ", optOut)).toBe("STOP");
    expect(matchingKeyword("stop.", optOut)).toBe("STOP");
    expect(matchingKeyword("Unsubscribe now", optOut)).toBe("UNSUBSCRIBE");
    expect(matchingKeyword("退订", optOut)).toBe("退订");
    expect(matchingKeyword("退订。", optOut)).toBe("退订");
    expect(matchingKeyword("STOPPING", optOut)).toBeNull();
    expect(matchingKeyword("please STOP", optOut)).toBeNull();
  });

  it("matches opt-in keywords without treating them as opt-out", () => {
    expect(matchingKeyword("START", optIn)).toBe("START");
    expect(matchingKeyword("订阅", optIn)).toBe("订阅");
    expect(matchingKeyword("START", optOut)).toBeNull();
  });
});

describe("confirmationLanguage", () => {
  it("uses Chinese when the reply contains Han characters", () => {
    expect(confirmationLanguage("退订")).toBe("zh");
    expect(confirmationLanguage("STOP")).toBe("en");
  });
});
