import { AppError, COOKIE, SAFE_TEXT, apiData, loadEnv } from "@gchopro/core";
import { cancelGroup } from "@gchopro/db";
import { caught, guardCsrf, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    const params = await context.params;
    if (!/^[0-9a-f-]{36}$/iu.test(params.id))
      throw new AppError(400, "invalid_body", SAFE_TEXT.invalid_body);
    return apiData(await cancelGroup(await tokenFrom(COOKIE.portal), params.id));
  } catch (error) {
    return caught(error);
  }
}
