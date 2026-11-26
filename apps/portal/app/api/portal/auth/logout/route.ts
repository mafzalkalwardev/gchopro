import { COOKIE, loadEnv } from "@gchopro/core";
import { logout } from "@gchopro/db";
import { caught, clearSessionCookie, guardCsrf, requestId, requestIp, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    await logout(await tokenFrom(COOKIE.portal), requestIp(request), requestId(request));
    await clearSessionCookie(COOKIE.portal);
    return new Response(null, { status: 204 });
  } catch (error) {
    return caught(error);
  }
}
