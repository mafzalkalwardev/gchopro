import { COOKIE, apiData } from "@gchopro/core";
import { portalProfile } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const profile = await portalProfile(await tokenFrom(COOKIE.portal));
    return apiData({ usage: profile.usage, limits: profile.limits });
  } catch (error) {
    return caught(error);
  }
}
