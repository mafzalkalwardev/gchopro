import { COOKIE, apiData, loadEnv, templateBody } from "@gchopro/core";
import { listSharedTemplates, saveSharedTemplate } from "@gchopro/db";
import { adminActor } from "@/lib/actor";
import { caught, guardCsrf, readJson, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return apiData(await listSharedTemplates(await tokenFrom(COOKIE.admin)));
  } catch (error) {
    return caught(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    const actor = await adminActor(request);
    return apiData(await saveSharedTemplate(actor, await readJson(request, templateBody)), 201);
  } catch (error) {
    return caught(error);
  }
}
