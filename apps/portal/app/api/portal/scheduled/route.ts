import { COOKIE, apiData } from "@gchopro/core";
import { listScheduled } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return apiData(await listScheduled(await tokenFrom(COOKIE.portal)));
  } catch (error) {
    return caught(error);
  }
}
