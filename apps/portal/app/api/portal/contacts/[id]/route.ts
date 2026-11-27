import { AppError, COOKIE, SAFE_TEXT, apiData, contactBody, loadEnv } from "@gchopro/core";
import { deleteContact, patchContact } from "@gchopro/db";
import { allowFormPost, caught, formRedirect, guardCsrf, readJson, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function idOf(context: { params: Promise<{ id: string }> }): Promise<string> {
  const params = await context.params;
  if (!/^[0-9a-f-]{36}$/iu.test(params.id))
    throw new AppError(400, "invalid_body", SAFE_TEXT.invalid_body);
  return params.id;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const denied = await allowFormPost(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    const form = await request.formData();
    const note = String(form.get("consentNote") ?? "").trim();
    const tags = form
      .getAll("tags")
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0);
    const consentAt = String(form.get("consentAt") ?? "");
    const parsed = contactBody.safeParse({
      name: form.get("name"),
      number: form.get("number"),
      consentSource: form.get("consentSource"),
      ...(note.length > 0 ? { consentNote: note } : {}),
      ...(consentAt.length > 0 ? { consentAt } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    });
    if (!parsed.success) return formRedirect(request, "/contacts?send=invalid_body");
    await patchContact(await tokenFrom(COOKIE.portal), await idOf(context), parsed.data);
    return formRedirect(request, "/contacts");
  } catch (error) {
    if (error instanceof AppError) {
      const safe = /^[a-z_]+$/u.test(error.code) ? error.code : "invalid_body";
      return formRedirect(request, `/contacts?send=${safe}`);
    }
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
    return apiData(
      await patchContact(
        await tokenFrom(COOKIE.portal),
        await idOf(context),
        await readJson(request, contactBody),
      ),
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
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    await deleteContact(await tokenFrom(COOKIE.portal), await idOf(context));
    return new Response(null, { status: 204 });
  } catch (error) {
    return caught(error);
  }
}
