import { COOKIE, SESSION_MS, apiData, loadEnv } from "@gchopro/core";
import { login } from "@gchopro/db";
import { z } from "zod";
import { caught, guardCsrf, readJson, requestId, requestIp, writeSessionCookie } from "@/lib/http";

const bodySchema = z.object({
  username: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(128),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    const body = await readJson(request, bodySchema);
    const result = await login({
      app: "portal",
      username: body.username,
      password: body.password,
      ip: requestIp(request),
      userAgent: request.headers.get("user-agent"),
      requestId: requestId(request),
    });
    if (!result.ok)
      return Response.json(
        { error: result.code, message: result.message },
        { status: result.status },
      );
    await writeSessionCookie(
      COOKIE.portal,
      result.token,
      new Date(Date.now() + SESSION_MS.portal.absolute),
    );
    return apiData({ mustChangePassword: result.mustChangePassword });
  } catch (error) {
    return caught(error);
  }
}
