import { COOKIE, apiData, loadEnv, sendBody } from "@gchopro/core";
import { sendMessage } from "@gchopro/db";
import { caught, guardCsrf, readJson, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    const body = await readJson(request, sendBody);
    return apiData(await sendMessage(await tokenFrom(COOKIE.portal), body), 201);
  } catch (error) {
    return caught(error);
  }
}
