import { apiData, loadEnv, policyBody } from "@gchopro/core";
import { listPolicyRows, savePolicy } from "@gchopro/db";
import { adminActor } from "@/lib/actor";
import { caught, guardCsrf, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    await adminActor(request);
    return apiData(await listPolicyRows());
  } catch (error) {
    return caught(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    const actor = await adminActor(request);
    return apiData(await savePolicy(actor, await readJson(request, policyBody)), 201);
  } catch (error) {
    return caught(error);
  }
}
