import { COOKIE, apiData, loadEnv } from "@gchopro/core";
import { testTranslationProvider } from "@gchopro/db";
import { caught, guardCsrf, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    return apiData(await testTranslationProvider(await tokenFrom(COOKIE.admin)));
  } catch (error) {
    return caught(error);
  }
}
