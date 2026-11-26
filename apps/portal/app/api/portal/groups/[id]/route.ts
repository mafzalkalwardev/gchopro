import { AppError, COOKIE, SAFE_TEXT, apiData, contactGroupBody, loadEnv } from "@gchopro/core";
import { deleteContactGroup, saveContactGroup } from "@gchopro/db";
import { caught, guardCsrf, readJson, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function idOf(context: { params: Promise<{ id: string }> }): Promise<string> {
  const params = await context.params;
  if (!/^[0-9a-f-]{36}$/iu.test(params.id))
    throw new AppError(400, "invalid_body", SAFE_TEXT.invalid_body);
  return params.id;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    const id = await idOf(context);
    const body = await readJson(request, contactGroupBody);
    return apiData(await saveContactGroup(await tokenFrom(COOKIE.portal), { ...body, id }));
  } catch (error) {
    return caught(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    await deleteContactGroup(await tokenFrom(COOKIE.portal), await idOf(context));
    return new Response(null, { status: 204 });
  } catch (error) {
    return caught(error);
  }
}
