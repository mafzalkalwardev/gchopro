import { apiData, loadEnv } from "@gchopro/core";
import { resumeSim } from "@gchopro/db";
import { adminActor } from "@/lib/actor";
import { caught, guardCsrf } from "@/lib/http";

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
    return apiData(await resumeSim(actor, id));
  } catch (error) {
    return caught(error);
  }
}
