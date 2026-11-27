import { AppError, COOKIE, SAFE_TEXT, apiData, conversationPatch, loadEnv } from "@gchopro/core";
import { listThread, markRead, patchConversation } from "@gchopro/db";
import { allowFormPost, caught, formRedirect, guardCsrf, readJson, tokenFrom } from "@/lib/http";

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
    const id = await idOf(context);
    if (!formPost) {
      await markRead(await tokenFrom(COOKIE.portal), id);
      return new Response(null, { status: 204 });
    }
    const form = await request.formData();
    const action = String(form.get("action") ?? "");
    const token = await tokenFrom(COOKIE.portal);
    if (action === "archive") {
      await patchConversation(token, id, { archived: form.get("archived") === "true" });
    } else if (action === "tag") {
      const tags = form
        .getAll("tags")
        .map((value) => String(value).trim())
        .filter((value) => value.length > 0);
      const extra = String(form.get("tag") ?? "").trim();
      if (extra.length > 0 && !tags.includes(extra)) tags.push(extra);
      await patchConversation(token, id, { tags });
    }
    return formRedirect(request, returnPath(form));
  } catch (error) {
    return caught(error);
  }
}
