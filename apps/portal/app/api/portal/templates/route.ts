import { COOKIE, apiData, loadEnv, templateBody } from "@gchopro/core";
import { listPortalTemplates, savePortalTemplate } from "@gchopro/db";
import { caught, guardCsrf, readJson, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return apiData(await listPortalTemplates(await tokenFrom(COOKIE.portal)));
  } catch (error) {
    return caught(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    return apiData(
      await savePortalTemplate(
        await tokenFrom(COOKIE.portal),
        await readJson(request, templateBody),
      ),
      201,
    );
  } catch (error) {
    return caught(error);
  }
}
