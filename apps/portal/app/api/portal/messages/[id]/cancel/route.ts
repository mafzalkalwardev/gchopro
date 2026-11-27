import { AppError, COOKIE, SAFE_TEXT, apiData, loadEnv } from "@gchopro/core";
import { cancelMessage } from "@gchopro/db";
import { allowFormPost, caught, formRedirect, guardCsrf, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function returnPath(form: FormData): string {
  const value = form.get("next");
  return typeof value === "string" && /^\/[A-Za-z0-9/_-]*$/u.test(value) ? value : "/";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  const formPost = !contentType.includes("application/json");
  try {
    const host = loadEnv().PORTAL_HOST;
    const denied = formPost ? await allowFormPost(request, host) : await guardCsrf(request, host);
    if (denied) return denied;
    const params = await context.params;
    if (!/^[0-9a-f-]{36}$/iu.test(params.id)) {
      throw new AppError(400, "invalid_body", SAFE_TEXT.invalid_body);
    }
    const sent = await cancelMessage(await tokenFrom(COOKIE.portal), params.id);
    if (!formPost) return apiData(sent);
    const form = await request.formData();
    return formRedirect(request, returnPath(form));
  } catch (error) {
    return caught(error);
  }
}
