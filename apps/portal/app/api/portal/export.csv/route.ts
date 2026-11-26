import { COOKIE } from "@gchopro/core";
import { exportMessages } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const csv = await exportMessages(await tokenFrom(COOKIE.portal));
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="messages.csv"',
      },
    });
  } catch (error) {
    return caught(error);
  }
}
