import { apiData, devicePatch, loadEnv } from "@gchopro/core";
import { getDevice, patchDevice } from "@gchopro/db";
import { adminActor } from "@/lib/actor";
import { caught, guardCsrf, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await adminActor(request);
    const { id } = await context.params;
    return apiData(await getDevice(id));
  } catch (error) {
    return caught(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const rejected = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (rejected) return rejected;
    const actor = await adminActor(request);
    const { id } = await context.params;
    return apiData(await patchDevice(actor, id, await readJson(request, devicePatch)));
  } catch (error) {
    return caught(error);
  }
}
