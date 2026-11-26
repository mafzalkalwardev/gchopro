import { apiData, loadEnv, retestRequest } from "@gchopro/core";
import { retestSim } from "@gchopro/db";
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
    const body = await readJson(request, retestRequest);
    return apiData(await retestSim(actor, id, body.testNumber));
  } catch (error) {
    return caught(error);
  }
}
