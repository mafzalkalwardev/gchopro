import { AppError, COOKIE, loadEnv } from "@gchopro/core";
import { changePassword } from "@gchopro/db";
import { z } from "zod";
import {
  allowFormPost,
  caught,
  formRedirect,
  guardCsrf,
  readJson,
  requestId,
  requestIp,
  tokenFrom,
} from "@/lib/http";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failed(request: Request, code: string): Response {
  const safe = /^[a-z_]+$/u.test(code) ? code : "invalid_body";
  return formRedirect(request, `/password?reason=${safe}`);
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  const formPost = !contentType.includes("application/json");
  try {
    const host = loadEnv().PORTAL_HOST;
    const denied = formPost ? await allowFormPost(request, host) : await guardCsrf(request, host);
    if (denied) return denied;
    const body = formPost ? await formBody(request) : await readJson(request, bodySchema);
    if (body === null) return failed(request, "invalid_body");
    try {
      await changePassword({
        token: await tokenFrom(COOKIE.portal),
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        ip: requestIp(request),
        requestId: requestId(request),
      });
    } catch (error) {
      if (formPost && error instanceof AppError) return failed(request, error.code);
      throw error;
    }
    if (formPost) return formRedirect(request, "/");
    return new Response(null, { status: 204 });
  } catch (error) {
    return caught(error);
  }
}

async function formBody(
  request: Request,
): Promise<{ currentPassword: string; newPassword: string } | null> {
  const form = await request.formData();
  const parsed = bodySchema.safeParse({
    currentPassword: form.get("current"),
    newPassword: form.get("next"),
  });
  return parsed.success ? parsed.data : null;
}
