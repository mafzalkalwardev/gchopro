import { COOKIE, apiData, loadEnv } from "@gchopro/core";
import { createOptOut, listOptOuts } from "@gchopro/db";
import { z } from "zod";
import { adminActor } from "@/lib/actor";
import { caught, guardCsrf, readJson, tokenFrom } from "@/lib/http";

const bodySchema = z.object({
  number: z.string().min(3).max(20),
  scope: z.enum(["global", "user"]),
  userId: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return apiData(await listOptOuts(await tokenFrom(COOKIE.admin)));
  } catch (error) {
    return caught(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    const actor = await adminActor(request);
    const body = await readJson(request, bodySchema);
    return apiData(
      await createOptOut(await tokenFrom(COOKIE.admin), body, {
        userId: actor.userId,
        role: actor.role,
        kind: "admin",
        ip: actor.ip,
        requestId: actor.requestId,
      }),
      201,
    );
  } catch (error) {
    return caught(error);
  }
}
