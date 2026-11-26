import { AppError, SAFE_TEXT, apiData, loadEnv, templateBody } from "@gchopro/core";
import { deleteSharedTemplate, saveSharedTemplate } from "@gchopro/db";
import { adminActor } from "@/lib/actor";
import { caught, guardCsrf, readJson } from "@/lib/http";

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
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    const actor = await adminActor(request);
    const id = await idOf(context);
    return apiData(
      await saveSharedTemplate(actor, { ...(await readJson(request, templateBody)), id }),
    );
  } catch (error) {
    return caught(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    const actor = await adminActor(request);
    await deleteSharedTemplate(actor, await idOf(context));
    return new Response(null, { status: 204 });
  } catch (error) {
    return caught(error);
  }
}
