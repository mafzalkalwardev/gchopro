import { COOKIE, apiData } from "@gchopro/core";
import { analyticsSeries, requireReady } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireReady(await tokenFrom(COOKIE.admin), "admin");
    const query = new URL(request.url).searchParams;
    return apiData(
      await analyticsSeries({
        from: query.get("from") ?? undefined,
        to: query.get("to") ?? undefined,
        granularity: query.get("granularity") ?? undefined,
        userId: query.get("userId") ?? undefined,
        simId: query.get("simId") ?? undefined,
      }),
    );
  } catch (error) {
    return caught(error);
  }
}
