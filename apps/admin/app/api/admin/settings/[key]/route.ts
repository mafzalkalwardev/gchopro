import { COOKIE, apiData, loadEnv } from "@gchopro/core";
import { updateSetting } from "@gchopro/db";
import { z } from "zod";
import { caught, guardCsrf, readJson, requestId, requestIp, tokenFrom } from "@/lib/http";

const bodySchema = z.object({ value: z.unknown() });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ key: string }> },
): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    const { key } = await context.params;
    const body = await readJson(request, bodySchema);
    const value = await updateSetting({
      token: await tokenFrom(COOKIE.admin),
      key,
      value: body.value,
      ip: requestIp(request),
      requestId: requestId(request),
    });
    return apiData(value);
  } catch (error) {
    return caught(error);
  }
}
