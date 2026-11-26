import { COOKIE } from "@gchopro/core";
import { requireReady, type AdminActor } from "@gchopro/db";
import { requestId, requestIp, tokenFrom } from "@/lib/http";

export async function adminActor(request: Request): Promise<AdminActor> {
  const session = await requireReady(await tokenFrom(COOKIE.admin), "admin");
  return {
    userId: session.userId,
    role: session.role,
    ip: requestIp(request),
    requestId: requestId(request),
  };
}
