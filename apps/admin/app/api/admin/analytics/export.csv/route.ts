import { COOKIE } from "@gchopro/core";
import { analyticsExport, requireReady } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireReady(await tokenFrom(COOKIE.admin), "admin");
    const query = new URL(request.url).searchParams;
    const csv = await analyticsExport({
      from: query.get("from") ?? undefined,
      to: query.get("to") ?? undefined,
      scope: query.get("scope") ?? undefined,
    });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="analytics.csv"',
      },
    });
  } catch (error) {
    return caught(error);
  }
}
