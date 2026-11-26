import { COOKIE, apiData } from "@gchopro/core";
import { analyticsSeries, portalProfile } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const profile = await portalProfile(await tokenFrom(COOKIE.portal));
    const query = new URL(request.url).searchParams;
    const report = await analyticsSeries({
      from: query.get("from") ?? undefined,
      to: query.get("to") ?? undefined,
      userId: profile.id,
      granularity: "day",
    });
    return apiData({
      usage: profile.usage,
      limits: profile.limits,
      series: report.series,
      totals: report.totals,
    });
  } catch (error) {
    return caught(error);
  }
}
