import { COOKIE, apiData, loadEnv, previewBody } from "@gchopro/core";
import { previewMessage } from "@gchopro/db";
import { caught, guardCsrf, readJson, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    const body = await readJson(request, previewBody);
    return apiData(await previewMessage(await tokenFrom(COOKIE.portal), body));
  } catch (error) {
    return caught(error);
  }
}
