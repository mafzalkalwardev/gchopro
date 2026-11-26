import { COOKIE, apiData } from "@gchopro/core";
import { requireReady } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const session = await requireReady(await tokenFrom(COOKIE.admin), "admin");
    return apiData({
      id: session.userId,
      username: session.username,
      displayName: session.displayName,
    });
  } catch (error) {
    return caught(error);
  }
}
