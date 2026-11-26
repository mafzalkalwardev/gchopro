import { COOKIE, apiData } from "@gchopro/core";
import { listConversations } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams;
    return apiData(
      await listConversations(await tokenFrom(COOKIE.portal), {
        q: query.get("q") ?? undefined,
        filter: query.get("filter") ?? undefined,
        tag: query.get("tag") ?? undefined,
        cursor: query.get("cursor") ?? undefined,
      }),
    );
  } catch (error) {
    return caught(error);
  }
}
