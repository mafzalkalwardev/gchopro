import { COOKIE, apiData, loadEnv } from "@gchopro/core";
import { verifyTotp } from "@gchopro/db";
import { z } from "zod";
import { caught, guardCsrf, readJson, requestId, requestIp, tokenFrom } from "@/lib/http";

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
  try {
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    const body = await readJson(request, bodySchema);
    const result = await verifyTotp({
      token: await tokenFrom(COOKIE.admin),
      code: body.code,
      recoveryCode: body.recoveryCode,
      ip: requestIp(request),
      requestId: requestId(request),
    });
    return apiData({ ok: true, recoveryCodes: result.recoveryCodes });
  } catch (error) {
    return caught(error);
  }
}
