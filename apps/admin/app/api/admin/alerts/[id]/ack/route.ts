import { COOKIE, apiData, loadEnv } from "@gchopro/core";
import { acknowledgeAlert } from "@gchopro/db";
import { caught, guardCsrf, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    const { id } = await context.params;
    return apiData(await acknowledgeAlert(await tokenFrom(COOKIE.admin), id));
  } catch (error) {
    return caught(error);
  }
}
