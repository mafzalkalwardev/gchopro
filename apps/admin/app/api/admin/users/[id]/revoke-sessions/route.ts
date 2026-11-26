import { COOKIE, loadEnv } from "@gchopro/core";
import { revokeUserSessions } from "@gchopro/db";
import { z } from "zod";
import { caught, guardCsrf, requestId, requestIp, tokenFrom } from "@/lib/http";

const paramsSchema = z.object({ id: z.string().uuid() });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    const params = paramsSchema.parse(await context.params);
    await revokeUserSessions({
      actorToken: await tokenFrom(COOKIE.admin),
      userId: params.id,
      ip: requestIp(request),
      requestId: requestId(request),
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return caught(error);
  }
}
