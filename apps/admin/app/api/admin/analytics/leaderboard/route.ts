import { COOKIE, apiData } from "@gchopro/core";
import { analyticsLeaderboard, requireReady } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireReady(await tokenFrom(COOKIE.admin), "admin");
    const query = new URL(request.url).searchParams;
    return apiData(
      await analyticsLeaderboard({
        from: query.get("from") ?? undefined,
        to: query.get("to") ?? undefined,
        metric: query.get("metric") ?? undefined,
      }),
    );
  } catch (error) {
    return caught(error);
  }
}
