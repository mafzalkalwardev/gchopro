import { AppError, COOKIE, apiData, loadEnv, sendBody } from "@gchopro/core";
import { sendMessage } from "@gchopro/db";
import { allowFormPost, caught, formRedirect, guardCsrf, readJson, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function returnPath(form: FormData): string {
  const value = form.get("next");
  return typeof value === "string" && /^\/[A-Za-z0-9/_-]*$/u.test(value) ? value : "/";
}

function sendFailed(request: Request, form: FormData, code: string): Response {
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
      const body = await readJson(request, sendBody);
      return apiData(await sendMessage(await tokenFrom(COOKIE.portal), body), 201);
    }
    const form = await request.formData();
    const parsed = sendBody.safeParse({ to: form.get("to"), body: form.get("body") });
    if (!parsed.success) return sendFailed(request, form, "invalid_body");
    try {
      const sent = await sendMessage(await tokenFrom(COOKIE.portal), parsed.data);
      return formRedirect(request, `/c/${sent.conversationId}`);
    } catch (error) {
      if (error instanceof AppError) return sendFailed(request, form, error.code);
      return sendFailed(request, form, "invalid_body");
    }
  } catch (error) {
    return caught(error);
  }
}
