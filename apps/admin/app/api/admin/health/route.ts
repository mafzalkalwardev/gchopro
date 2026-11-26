import { COOKIE, apiData } from "@gchopro/core";
import { requireReady, systemHealth } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await requireReady(await tokenFrom(COOKIE.admin), "admin");
    return apiData(await systemHealth());
  } catch (error) {
    return caught(error);
  }
}
