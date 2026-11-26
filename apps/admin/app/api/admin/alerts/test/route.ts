import { apiData, loadEnv } from "@gchopro/core";
import { sendAlertTest } from "@gchopro/db";
import { adminActor } from "@/lib/actor";
import { caught, guardCsrf } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    await adminActor(request);
    return apiData(await sendAlertTest());
  } catch (error) {
    return caught(error);
  }
}
