import { AppError, COOKIE, SAFE_TEXT, apiData } from "@gchopro/core";
import { analyticsSeries, requireReady } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireReady(await tokenFrom(COOKIE.admin), "admin");
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/iu.test(id))
      throw new AppError(400, "invalid_body", SAFE_TEXT.invalid_body);
    const query = new URL(request.url).searchParams;
    return apiData(
      await analyticsSeries({
        from: query.get("from") ?? undefined,
        to: query.get("to") ?? undefined,
        granularity: query.get("granularity") ?? undefined,
        userId: id,
      }),
    );
  } catch (error) {
    return caught(error);
  }
}
