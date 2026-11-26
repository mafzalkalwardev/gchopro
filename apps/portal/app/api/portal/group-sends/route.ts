import { COOKIE, apiData, groupSendBody, loadEnv } from "@gchopro/core";
import { sendGroup } from "@gchopro/db";
import { caught, guardCsrf, readJson, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    const body = await readJson(request, groupSendBody);
    return apiData(await sendGroup(await tokenFrom(COOKIE.portal), body), 201);
  } catch (error) {
    return caught(error);
  }
}
