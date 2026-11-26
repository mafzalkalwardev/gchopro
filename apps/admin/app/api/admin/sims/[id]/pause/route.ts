import { apiData, loadEnv, pauseRequest } from "@gchopro/core";
import { pauseSim } from "@gchopro/db";
import { adminActor } from "@/lib/actor";
import { caught, guardCsrf, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const rejected = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (rejected) return rejected;
    const actor = await adminActor(request);
    const { id } = await context.params;
    const body = await readJson(request, pauseRequest);
    return apiData(await pauseSim(actor, id, body.reason));
  } catch (error) {
    return caught(error);
  }
}
