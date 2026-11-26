import { apiData, loadEnv, userCreate } from "@gchopro/core";
import { createUser, listUsers } from "@gchopro/db";
import { adminActor } from "@/lib/actor";
import { caught, guardCsrf, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    await adminActor(request);
    const query = new URL(request.url).searchParams;
    return apiData(
      await listUsers({
        q: query.get("q") ?? undefined,
        status: query.get("status") ?? undefined,
        subscription: query.get("subscription") ?? undefined,
        cursor: query.get("cursor") ?? undefined,
      }),
    );
  } catch (error) {
    return caught(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    const actor = await adminActor(request);
    const body = await readJson(request, userCreate);
    return apiData(await createUser(actor, body), 201);
  } catch (error) {
    return caught(error);
  }
}
