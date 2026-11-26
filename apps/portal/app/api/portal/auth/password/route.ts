import { COOKIE, loadEnv } from "@gchopro/core";
import { changePassword } from "@gchopro/db";
import { z } from "zod";
import { caught, guardCsrf, readJson, requestId, requestIp, tokenFrom } from "@/lib/http";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    const body = await readJson(request, bodySchema);
    await changePassword({
      token: await tokenFrom(COOKIE.portal),
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      ip: requestIp(request),
      requestId: requestId(request),
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return caught(error);
  }
}
