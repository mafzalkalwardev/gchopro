import { apiData, extendSubscriptionBody, loadEnv } from "@gchopro/core";
import { extendUserSubscription } from "@gchopro/db";
import { z } from "zod";
import { adminActor } from "@/lib/actor";
import { caught, guardCsrf, readJson } from "@/lib/http";

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
    const actor = await adminActor(request);
    const params = paramsSchema.parse(await context.params);
    const body = await readJson(request, extendSubscriptionBody);
    return apiData(await extendUserSubscription(actor, params.id, body));
  } catch (error) {
    return caught(error);
  }
}
