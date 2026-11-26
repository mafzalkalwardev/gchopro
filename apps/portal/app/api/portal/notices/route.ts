import { COOKIE, apiData } from "@gchopro/core";
import { listPortalNotices, requireReady } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const session = await requireReady(await tokenFrom(COOKIE.portal), "portal");
    return apiData(await listPortalNotices(session.userId));
  } catch (error) {
    return caught(error);
  }
}
