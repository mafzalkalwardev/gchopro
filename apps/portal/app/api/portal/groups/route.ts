import { COOKIE, apiData, contactGroupBody, loadEnv } from "@gchopro/core";
import { listContactGroups, saveContactGroup } from "@gchopro/db";
import { caught, guardCsrf, readJson, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return apiData(await listContactGroups(await tokenFrom(COOKIE.portal)));
  } catch (error) {
    return caught(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    const body = await readJson(request, contactGroupBody);
    return apiData(await saveContactGroup(await tokenFrom(COOKIE.portal), body), 201);
  } catch (error) {
    return caught(error);
  }
}
