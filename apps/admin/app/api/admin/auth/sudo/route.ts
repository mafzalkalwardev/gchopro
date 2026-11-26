import { COOKIE, apiData, loadEnv } from "@gchopro/core";
import { grantSudo } from "@gchopro/db";
import { z } from "zod";
import { caught, guardCsrf, readJson, tokenFrom } from "@/lib/http";

const bodySchema = z
  .object({
    password: z.string().min(1).max(128),
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
    const until = await grantSudo({
      token: await tokenFrom(COOKIE.admin),
      password: body.password,
      code: body.code,
      recoveryCode: body.recoveryCode,
    });
    return apiData({ until: until.toISOString() });
  } catch (error) {
    return caught(error);
  }
}
