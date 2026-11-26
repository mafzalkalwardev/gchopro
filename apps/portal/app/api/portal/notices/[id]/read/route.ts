import { COOKIE, loadEnv } from "@gchopro/core";
import { markNoticeRead, requireReady } from "@gchopro/db";
import { z } from "zod";
import { caught, guardCsrf, tokenFrom } from "@/lib/http";

const paramsSchema = z.object({ id: z.string().uuid() });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    const session = await requireReady(await tokenFrom(COOKIE.portal), "portal");
    const params = paramsSchema.parse(await context.params);
    await markNoticeRead(session.userId, params.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return caught(error);
  }
}
