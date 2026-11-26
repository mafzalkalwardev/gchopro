import { describe, expect, it } from "vitest";
import { adminAllowed, clientIp, ipInCidr } from "./allowlist.js";

describe("allowlist", () => {
  it("matches IPv4 and IPv6 prefixes", () => {
    expect(ipInCidr("127.0.0.1", "127.0.0.1/32")).toBe(true);
    expect(ipInCidr("10.1.2.3", "10.0.0.0/8")).toBe(true);
    expect(ipInCidr("11.0.0.1", "10.0.0.0/8")).toBe(false);
    expect(ipInCidr("::1", "::1/128")).toBe(true);
  });

  it("ignores a forwarded header that did not come from a trusted proxy", () => {
    expect(
      clientIp({
        forwardedFor: "8.8.8.8",
        appEnv: "production",
        trustedProxyCidrs: ["127.0.0.1/32"],
      }),
    ).toBeNull();
    expect(
      clientIp({
        forwardedFor: "203.0.113.5, 127.0.0.1",
        appEnv: "production",
        trustedProxyCidrs: ["127.0.0.1/32"],
      }),
    ).toBe("203.0.113.5");
  });

  it("uses loopback when development has no forwarding header", () => {
    const client = clientIp({
      forwardedFor: null,
      appEnv: "development",
      trustedProxyCidrs: ["127.0.0.1/32"],
    });
    expect(adminAllowed(client, ["127.0.0.1/32"])).toBe(true);
    expect(
      adminAllowed(
        clientIp({ forwardedFor: null, appEnv: "production", trustedProxyCidrs: ["127.0.0.1/32"] }),
        ["127.0.0.1/32"],
      ),
    ).toBe(false);
  });
});
