import { NextResponse, type NextRequest } from "next/server";
import {
  COOKIE,
  adminAllowed,
  clientIp,
  contentSecurityPolicy,
  hostnameOf,
  newCsrfToken,
  newNonce,
  securityHeaders,
} from "@gchopro/core/edge";

function list(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function middleware(request: NextRequest) {
  const host = hostnameOf(request.headers.get("host"));
  const expected = (process.env.ADMIN_HOST ?? "").toLowerCase();
  if (host === null || expected.length === 0 || host !== expected) {
    return new NextResponse("Not found", { status: 404 });
  }
  const appEnv =
    process.env.APP_ENV === "development" || process.env.APP_ENV === "test"
      ? process.env.APP_ENV
      : "production";
  const ip = clientIp({
    forwardedFor: request.headers.get("x-forwarded-for"),
    appEnv,
    trustedProxyCidrs: list(process.env.TRUSTED_PROXY_CIDRS),
  });
  if (!adminAllowed(ip, list(process.env.ADMIN_IP_ALLOWLIST))) {
    return new NextResponse("Not found", { status: 404 });
  }
  const nonce = newNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", contentSecurityPolicy(nonce));
  if (requestHeaders.get("x-request-id") === null)
    requestHeaders.set("x-request-id", crypto.randomUUID());
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of securityHeaders(nonce)) response.headers.set(name, value);
  if (request.cookies.get(COOKIE.csrf) === undefined) {
    response.cookies.set(COOKIE.csrf, newCsrfToken(), {
      httpOnly: false,
      secure: true,
      sameSite: "strict",
      path: "/",
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
