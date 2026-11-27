import { COOKIE, apiData, loadEnv } from "@gchopro/core";
import { verifyTotp } from "@gchopro/db";
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

const bodySchema = z
  .object({
    code: z
      .string()
      .regex(/^\d{6}$/u)
      .optional(),
    recoveryCode: z.string().min(8).max(32).optional(),
  })
  .refine((value) => (value.code === undefined) !== (value.recoveryCode === undefined));

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  const formPost = !contentType.includes("application/json");
  try {
    const host = loadEnv().ADMIN_HOST;
    const denied = formPost ? await allowFormPost(request, host) : await guardCsrf(request, host);
    if (denied) return denied;
    const body = formPost ? await formCode(request) : await readJson(request, bodySchema);
    if (body === null) return formRedirect(request, "/totp?reason=invalid_body");
    const result = await verifyTotp({
      token: await tokenFrom(COOKIE.admin),
      code: body.code,
      recoveryCode: body.recoveryCode,
      ip: requestIp(request),
      requestId: requestId(request),
    });
    if (formPost) return formRedirect(request, "/");
    return apiData({ ok: true, recoveryCodes: result.recoveryCodes });
  } catch (error) {
    if (formPost) return formRedirect(request, "/totp?reason=invalid_code");
    return caught(error);
  }
}

async function formCode(
  request: Request,
): Promise<{ code?: string; recoveryCode?: string } | null> {
  const form = await request.formData();
  const parsed = bodySchema.safeParse({ code: form.get("code") });
  return parsed.success ? parsed.data : null;
}
