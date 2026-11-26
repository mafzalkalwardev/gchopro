import { apiData, loadEnv, noticeCreate } from "@gchopro/core";
import { createNotice, listNotices } from "@gchopro/db";
import { adminActor } from "@/lib/actor";
import { caught, guardCsrf, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    await adminActor(request);
    return apiData(await listNotices());
  } catch (error) {
    return caught(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    const actor = await adminActor(request);
    const body = await readJson(request, noticeCreate);
    return apiData(await createNotice(actor, body), 201);
  } catch (error) {
    return caught(error);
  }
}
