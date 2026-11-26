import { AppError, COOKIE, SAFE_TEXT, loadEnv } from "@gchopro/core";
import { markRead } from "@gchopro/db";
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
    await markRead(await tokenFrom(COOKIE.portal), params.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return caught(error);
  }
}
