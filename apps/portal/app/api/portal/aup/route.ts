import { AppError, COOKIE, loadEnv } from "@gchopro/core";
import { acceptAup } from "@gchopro/db";
import {
  allowFormPost,
  caught,
  formRedirect,
  guardCsrf,
  requestId,
  requestIp,
  tokenFrom,
} from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  const formPost = !contentType.includes("application/json");
  try {
    const host = loadEnv().PORTAL_HOST;
    const denied = formPost ? await allowFormPost(request, host) : await guardCsrf(request, host);
    if (denied) return denied;
    try {
      await acceptAup(await tokenFrom(COOKIE.portal), requestIp(request), requestId(request));
    } catch (error) {
      if (formPost && error instanceof AppError) {
        const safe = /^[a-z_]+$/u.test(error.code) ? error.code : "invalid_body";
        return formRedirect(request, `/aup?reason=${safe}`);
      }
      throw error;
    }
    if (formPost) return formRedirect(request, "/");
    return new Response(null, { status: 204 });
  } catch (error) {
    return caught(error);
  }
}
