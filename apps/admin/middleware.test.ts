import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const previous = {
  host: process.env.ADMIN_HOST,
  appEnv: process.env.APP_ENV,
  allowlist: process.env.ADMIN_IP_ALLOWLIST,
  proxies: process.env.TRUSTED_PROXY_CIDRS,
};

function saveEnv(): void {
  previous.host = process.env.ADMIN_HOST;
  previous.appEnv = process.env.APP_ENV;
  previous.allowlist = process.env.ADMIN_IP_ALLOWLIST;
  previous.proxies = process.env.TRUSTED_PROXY_CIDRS;
  process.env.ADMIN_HOST = "admin.localhost";
  process.env.APP_ENV = "production";
  process.env.ADMIN_IP_ALLOWLIST = "203.0.113.50/32";
  process.env.TRUSTED_PROXY_CIDRS = "127.0.0.1/32";
}

function restoreEnv(): void {
  if (previous.host === undefined) delete process.env.ADMIN_HOST;
  else process.env.ADMIN_HOST = previous.host;
  if (previous.appEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = previous.appEnv;
  if (previous.allowlist === undefined) delete process.env.ADMIN_IP_ALLOWLIST;
  else process.env.ADMIN_IP_ALLOWLIST = previous.allowlist;
  if (previous.proxies === undefined) delete process.env.TRUSTED_PROXY_CIDRS;
  else process.env.TRUSTED_PROXY_CIDRS = previous.proxies;
}

function request(host: string, forwarded: string, path = "/login"): NextRequest {
  return new NextRequest(`https://admin.localhost:3001${path}`, {
    headers: { host, "x-forwarded-for": forwarded },
  });
}

afterEach(() => {
  restoreEnv();
});

describe("admin middleware", () => {
  it("returns 404 for a disallowed IP and a wrong host", async () => {
    saveEnv();
    const denied = await middleware(request("admin.localhost:3001", "198.51.100.9, 127.0.0.1"));
    expect(denied.status).toBe(404);
    const wrongHost = await middleware(request("evil.example", "203.0.113.50, 127.0.0.1"));
    expect(wrongHost.status).toBe(404);
  });

  it("puts a script nonce on an allowed response", async () => {
    saveEnv();
    const response = await middleware(request("admin.localhost:3001", "203.0.113.50, 127.0.0.1"));
    expect(response.status).toBe(200);
    const policy = response.headers.get("content-security-policy") ?? "";
    const script = policy.split(";").find((part) => part.trim().startsWith("script-src")) ?? "";
    expect(script).toContain("'nonce-");
    expect(script.includes("'unsafe-inline'")).toBe(false);
  });

  it("answers healthz before the host check", async () => {
    saveEnv();
    const response = await middleware(request("evil.example", "198.51.100.9", "/healthz"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});
