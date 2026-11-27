import { COOKIE, SESSION_MS, apiData, loadEnv } from "@gchopro/core";
import { login } from "@gchopro/db";
import { z } from "zod";
import {
  allowFormPost,
  caught,
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

function formRedirect(request: Request, path: string): Response {
  const configured = loadEnv().PUBLIC_PORTAL_URL.replace(/\/$/u, "");
  const header = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const base =
    header === null || header.startsWith("0.0.0.0") ? configured : `${proto}://${header}`;
  return Response.redirect(new URL(path, `${base}/`), 303);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const username = url.searchParams.get("username") ?? "";
  const password = url.searchParams.get("password") ?? "";
  if (username.length === 0 || password.length === 0) return formRedirect(request, "/login");
  try {
    const result = await login({
      app: "portal",
      username,
      password,
      ip: requestIp(request),
      userAgent: request.headers.get("user-agent"),
      requestId: requestId(request),
    });
    if (!result.ok) {
      const reason = /^[a-z_]+$/u.test(result.code) ? result.code : "invalid_credentials";
      return formRedirect(request, `/login?reason=${reason}`);
    }
    await writeSessionCookie(
      COOKIE.portal,
      result.token,
      new Date(Date.now() + SESSION_MS.portal.absolute),
    );
    return formRedirect(request, result.mustChangePassword ? "/password" : "/");
  } catch (error) {
    return caught(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const host = loadEnv().PORTAL_HOST;
    const contentType = request.headers.get("content-type") ?? "";
    const formPost = !contentType.includes("application/json");
    const denied = formPost ? await allowFormPost(request, host) : await guardCsrf(request, host);
    if (denied) return denied;
    const credentials = formPost
      ? await formCredentials(request)
      : await readJson(request, bodySchema);
    if (credentials === null) return formRedirect(request, "/login?reason=invalid_credentials");
    const result = await login({
      app: "portal",
      username: credentials.username,
      password: credentials.password,
      ip: requestIp(request),
      userAgent: request.headers.get("user-agent"),
      requestId: requestId(request),
    });
    if (!result.ok) {
      if (!formPost) {
        return Response.json(
          { error: result.code, message: result.message },
          { status: result.status },
        );
      }
      const reason = /^[a-z_]+$/u.test(result.code) ? result.code : "invalid_credentials";
      return formRedirect(request, `/login?reason=${reason}`);
    }
    await writeSessionCookie(
      COOKIE.portal,
      result.token,
      new Date(Date.now() + SESSION_MS.portal.absolute),
    );
    if (!formPost) return apiData({ mustChangePassword: result.mustChangePassword });
    const next = result.mustChangePassword ? "/password" : "/";
    return formRedirect(request, next);
  } catch (error) {
    return caught(error);
  }
}
