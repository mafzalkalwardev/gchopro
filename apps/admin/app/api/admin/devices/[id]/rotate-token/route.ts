import { loadEnv } from "@gchopro/core";
import { requestRotation } from "@gchopro/db";
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
    await requestRotation(actor, id);
    return new Response(null, { status: 202 });
  } catch (error) {
    return caught(error);
  }
}
