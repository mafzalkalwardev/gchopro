import { AppError, COOKIE, SAFE_TEXT, apiData } from "@gchopro/core";
import { listThread } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const params = await context.params;
    if (!/^[0-9a-f-]{36}$/iu.test(params.id))
      throw new AppError(400, "invalid_body", SAFE_TEXT.invalid_body);
    const thread = await listThread(await tokenFrom(COOKIE.portal), params.id);
    return apiData({ messages: thread.messages });
  } catch (error) {
    return caught(error);
  }
}
