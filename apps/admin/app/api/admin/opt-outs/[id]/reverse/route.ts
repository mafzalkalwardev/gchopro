import { COOKIE, apiData, loadEnv } from "@gchopro/core";
import { reverseOptOut } from "@gchopro/db";
import { z } from "zod";
import { adminActor } from "@/lib/actor";
import { caught, guardCsrf, readJson, tokenFrom } from "@/lib/http";

const bodySchema = z.object({
  reason: z.string().min(1).max(500),
  evidence: z.string().min(1).max(500),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    const actor = await adminActor(request);
    const { id } = await context.params;
    const body = await readJson(request, bodySchema);
    return apiData(
      await reverseOptOut(await tokenFrom(COOKIE.admin), id, body, {
        userId: actor.userId,
        role: actor.role,
        kind: "admin",
        ip: actor.ip,
        requestId: actor.requestId,
      }),
    );
  } catch (error) {
    return caught(error);
  }
}
