import { apiData, pairingRequest } from "@gchopro/core";
import { createPairing } from "@gchopro/db";
import { adminActor } from "@/lib/actor";
import { caught, guardCsrf, readJson } from "@/lib/http";
import { loadEnv } from "@gchopro/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const rejected = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (rejected) return rejected;
    const actor = await adminActor(request);
    const body = await readJson(request, pairingRequest);
    return apiData(await createPairing(actor, body.name));
  } catch (error) {
    return caught(error);
  }
}
