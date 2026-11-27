import { COOKIE, SESSION_MS, apiData, loadEnv } from "@gchopro/core";
import { login } from "@gchopro/db";
import { z } from "zod";
import {
  allowFormPost,
  caught,
  formRedirect,
  guardCsrf,
  readJson,
  requestId,
  requestIp,
  writeSessionCookie,
} from "@/lib/http";

const bodySchema = z.object({
  username: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(128),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failed(request: Request, code: string): Response {
  const safe = /^[a-z_]+$/u.test(code) ? code : "invalid_credentials";
  return formRedirect(request, `/login?reason=${safe}`);
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  const formPost = !contentType.includes("application/json");
  try {
    const host = loadEnv().ADMIN_HOST;
    const denied = formPost ? await allowFormPost(request, host) : await guardCsrf(request, host);
    if (denied) return denied;
    const body = formPost ? await formCredentials(request) : await readJson(request, bodySchema);
    if (body === null) return failed(request, "invalid_credentials");
    const result = await login({
      app: "admin",
      username: body.username,
      password: body.password,
      ip: requestIp(request),
      userAgent: request.headers.get("user-agent"),
      requestId: requestId(request),
    });
    if (!result.ok) {
      if (formPost) return failed(request, result.code);
      return Response.json(
        { error: result.code, message: result.message },
        { status: result.status },
      );
    }
    await writeSessionCookie(
      COOKIE.admin,
      result.token,
      new Date(Date.now() + SESSION_MS.admin.absolute),
    );
    if (formPost) return formRedirect(request, "/totp");
    return apiData({ mfaRequired: true, enrollRequired: result.enrollRequired });
  } catch (error) {
    return caught(error);
  }
}

async function formCredentials(
  request: Request,
): Promise<{ username: string; password: string } | null> {
  const form = await request.formData();
  const parsed = bodySchema.safeParse({
    username: form.get("username"),
    password: form.get("password"),
  });
  return parsed.success ? parsed.data : null;
}
