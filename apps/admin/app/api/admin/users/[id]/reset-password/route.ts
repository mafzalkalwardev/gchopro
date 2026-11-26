import { AppError, SAFE_TEXT, apiData, loadEnv, passwordReset } from "@gchopro/core";
import { assertSudo, resetUserPassword } from "@gchopro/db";
import { z } from "zod";
import { adminActor } from "@/lib/actor";
import { caught, guardCsrf, readJson } from "@/lib/http";

const paramsSchema = z.object({ id: z.string().uuid() });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    const actor = await adminActor(request);
    if (actor.sessionId === undefined) {
      throw new AppError(403, "sudo_required", SAFE_TEXT.sudo_required);
    }
    await assertSudo(actor.sessionId);
    const params = paramsSchema.parse(await context.params);
    const body = await readJson(request, passwordReset);
    return apiData(await resetUserPassword(actor, params.id, body.newPassword));
  } catch (error) {
    return caught(error);
  }
}
