import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./headers.js";

describe("content security policy", () => {
  it("puts a nonce on script-src", () => {
    const policy = contentSecurityPolicy("abc");
    const script = policy.split(";").find((part) => part.trim().startsWith("script-src")) ?? "";
    expect(script).toContain("'nonce-abc'");
    expect(script).toContain("'strict-dynamic'");
    expect(script.includes("'unsafe-inline'")).toBe(false);
  });
});
