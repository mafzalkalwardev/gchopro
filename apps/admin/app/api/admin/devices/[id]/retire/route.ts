import { apiData, loadEnv, retireRequest } from "@gchopro/core";
import { retireDevice } from "@gchopro/db";
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
    await readJson(request, retireRequest);
    const { id } = await context.params;
    return apiData(await retireDevice(actor, id));
  } catch (error) {
    return caught(error);
  }
}
