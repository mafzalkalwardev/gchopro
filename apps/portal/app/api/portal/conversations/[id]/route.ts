import { AppError, COOKIE, SAFE_TEXT, apiData, conversationPatch, loadEnv } from "@gchopro/core";
import { listThread, markRead, patchConversation } from "@gchopro/db";
import { caught, guardCsrf, readJson, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function idOf(context: { params: Promise<{ id: string }> }): Promise<string> {
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
    return apiData(await listThread(await tokenFrom(COOKIE.portal), await idOf(context)));
  } catch (error) {
    return caught(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    const body = await readJson(request, conversationPatch);
    return apiData(
      await patchConversation(await tokenFrom(COOKIE.portal), await idOf(context), body),
    );
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
    await markRead(await tokenFrom(COOKIE.portal), await idOf(context));
    return new Response(null, { status: 204 });
  } catch (error) {
    return caught(error);
  }
}
