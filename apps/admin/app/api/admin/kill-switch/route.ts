import { COOKIE, apiData, loadEnv } from "@gchopro/core";
import { setKillSwitch } from "@gchopro/db";
import { z } from "zod";
import { caught, guardCsrf, readJson, requestIp, tokenFrom } from "@/lib/http";

const bodySchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(1).max(500),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    const body = await readJson(request, bodySchema);
    const value = await setKillSwitch({
      token: await tokenFrom(COOKIE.admin),
      enabled: body.enabled,
      reason: body.reason,
      ip: requestIp(request),
    });
    return apiData(value);
  } catch (error) {
    return caught(error);
  }
}
