import { cookies } from "next/headers";
import {
  AppError,
  COOKIE,
  SAFE_TEXT,
  apiError,
  apiFromError,
  clientIp,
  csrfRejected,
  loadEnv,
} from "@gchopro/core";
import type { ZodType } from "zod";

const SESSION_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
};

export async function guardCsrf(request: Request, expectedHost: string): Promise<Response | null> {
  const jar = await cookies();
  const rejected = csrfRejected({
    method: request.method,
    origin: request.headers.get("origin"),
    headerToken: request.headers.get("x-csrf-token"),
    cookieToken: jar.get(COOKIE.csrf)?.value ?? null,
    expectedHost,
  });
  if (!rejected) return null;
  return apiError("csrf_failed", SAFE_TEXT.csrf_failed, 403);
}

export async function allowFormPost(
  request: Request,
  expectedHost: string,
): Promise<Response | null> {
  const jar = await cookies();
  const cookieToken = jar.get(COOKIE.csrf)?.value ?? "";
  if (cookieToken.length === 0) return apiError("csrf_failed", SAFE_TEXT.csrf_failed, 403);
  const origin = request.headers.get("origin");
  if (origin === null || origin === "null") return null;
  try {
    if (new URL(origin).hostname !== expectedHost) {
      return apiError("csrf_failed", SAFE_TEXT.csrf_failed, 403);
    }
  } catch {
    return apiError("csrf_failed", SAFE_TEXT.csrf_failed, 403);
  }
  return null;
}

export function requestIp(request: Request): string | null {
  const env = loadEnv();
  return clientIp({
    forwardedFor: request.headers.get("x-forwarded-for"),
    appEnv: env.APP_ENV,
    trustedProxyCidrs: env.TRUSTED_PROXY_CIDRS.split(",").map((part) => part.trim()),
  });
}

export function requestId(request: Request): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const text = await request.text();
  if (text.length > 65_536) throw new AppError(413, "invalid_body", SAFE_TEXT.invalid_body);
  let body: unknown = {};
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new AppError(400, "invalid_body", SAFE_TEXT.invalid_body);
    }
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError(400, "invalid_body", SAFE_TEXT.invalid_body);
  return parsed.data;
}

export async function tokenFrom(cookieName: string): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(cookieName)?.value;
}

export async function writeSessionCookie(
  name: string,
  token: string,
  expires: Date,
): Promise<void> {
  const jar = await cookies();
  jar.set(name, token, { ...SESSION_COOKIE, expires });
}

export async function clearSessionCookie(name: string): Promise<void> {
  const jar = await cookies();
  jar.set(name, "", { ...SESSION_COOKIE, maxAge: 0 });
}

export function caught(error: unknown): Response {
  return apiFromError(error);
}

export function formRedirect(request: Request, path: string): Response {
  const header = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const host =
    header === null || header.startsWith("0.0.0.0")
      ? `localhost${header?.slice("0.0.0.0".length) ?? ""}`
      : header;
  return Response.redirect(new URL(path, `${proto}://${host}/`), 303);
}

export function redirectNext(request: Request, form: FormData, fallback: string): Response {
  const value = form.get("next");
  const path = typeof value === "string" && /^\/[A-Za-z0-9/_-]*$/u.test(value) ? value : fallback;
  return formRedirect(request, path);
}
