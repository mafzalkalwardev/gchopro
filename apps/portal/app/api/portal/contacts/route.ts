import { AppError, COOKIE, apiData, contactBody, loadEnv } from "@gchopro/core";
import { createContact, listContacts } from "@gchopro/db";
import { allowFormPost, caught, formRedirect, guardCsrf, readJson, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return apiData(await listContacts(await tokenFrom(COOKIE.portal)));
  } catch (error) {
    return caught(error);
  }
}

function returnPath(form: FormData): string {
  const value = form.get("next");
  return typeof value === "string" && /^\/[A-Za-z0-9/_-]*$/u.test(value) ? value : "/contacts";
}

function contactFailed(request: Request, form: FormData, code: string): Response {
  const safe = /^[a-z_]+$/u.test(code) ? code : "invalid_body";
  return formRedirect(request, `${returnPath(form)}?send=${safe}`);
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  const formPost = !contentType.includes("application/json");
  try {
    const host = loadEnv().PORTAL_HOST;
    const denied = formPost ? await allowFormPost(request, host) : await guardCsrf(request, host);
    if (denied) return denied;
    if (!formPost) {
      const body = await readJson(request, contactBody);
      return apiData(await createContact(await tokenFrom(COOKIE.portal), body), 201);
    }
    const form = await request.formData();
    const note = String(form.get("consentNote") ?? "").trim();
    const parsed = contactBody.safeParse({
      name: form.get("name"),
      number: form.get("number"),
      consentSource: form.get("consentSource"),
      ...(note.length > 0 ? { consentNote: note } : {}),
    });
    if (!parsed.success) return contactFailed(request, form, "invalid_body");
    try {
      await createContact(await tokenFrom(COOKIE.portal), parsed.data);
      return formRedirect(request, returnPath(form));
    } catch (error) {
      if (error instanceof AppError) return contactFailed(request, form, error.code);
      return contactFailed(request, form, "invalid_body");
    }
  } catch (error) {
    return caught(error);
  }
}
