import { COOKIE, apiData } from "@gchopro/core";
import { listAlerts } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const status = new URL(request.url).searchParams.get("status");
    const filter = status === "acknowledged" || status === "resolved" ? status : "open";
    return apiData(await listAlerts(await tokenFrom(COOKIE.admin), filter));
  } catch (error) {
    return caught(error);
  }
}
