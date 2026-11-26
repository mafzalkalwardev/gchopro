import { COOKIE, apiData } from "@gchopro/core";
import { requireReady } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    await requireReady(await tokenFrom(COOKIE.portal), "portal");
    return apiData({ enabled: false });
  } catch (error) {
    return caught(error);
  }
}
