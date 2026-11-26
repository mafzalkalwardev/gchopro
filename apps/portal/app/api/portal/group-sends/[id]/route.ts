import { AppError, COOKIE, SAFE_TEXT, apiData, loadEnv } from "@gchopro/core";
import { cancelGroup, groupProgress } from "@gchopro/db";
import { caught, guardCsrf, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function idFrom(context: { params: Promise<{ id: string }> }): Promise<string> {
  const params = await context.params;
  if (!/^[0-9a-f-]{36}$/iu.test(params.id))
    throw new AppError(400, "invalid_body", SAFE_TEXT.invalid_body);
  return params.id;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    return apiData(await groupProgress(await tokenFrom(COOKIE.portal), await idFrom(context)));
  } catch (error) {
    return caught(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    return apiData(await cancelGroup(await tokenFrom(COOKIE.portal), await idFrom(context)));
  } catch (error) {
    return caught(error);
  }
}
