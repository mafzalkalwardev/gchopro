import { NextResponse, type NextRequest } from "next/server";
import {
  COOKIE,
  contentSecurityPolicy,
  hostnameOf,
  newCsrfToken,
  newNonce,
  securityHeaders,
} from "@gchopro/core/edge";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/healthz") {
    return new NextResponse("ok", {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const host = hostnameOf(request.headers.get("host"));
  const portalHost = (process.env.PORTAL_HOST ?? "").toLowerCase();
  const gatewayHost = (process.env.GATEWAY_HOST ?? "").toLowerCase();
  const path = request.nextUrl.pathname;
  const gateway = host === gatewayHost && gatewayHost.length > 0;
  const portal = host === portalHost && portalHost.length > 0;
  if (gateway && !path.startsWith("/api/devices"))
    return new NextResponse("Not found", { status: 404 });
  if (!gateway && !portal) return new NextResponse("Not found", { status: 404 });
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
