import { COOKIE } from "@gchopro/core";
import { openUserEvents, requireReady } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const session = await requireReady(await tokenFrom(COOKIE.portal), "portal");
    const encoder = new TextEncoder();
    let close = async (): Promise<void> => undefined;
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(": ok\n\n"));
        const events = openUserEvents(session.userId, (message) => {
          const line = message.replace(/[\r\n]/gu, "");
          controller.enqueue(encoder.encode(`event: session.revoked\ndata: ${line}\n\n`));
        });
        close = events.close;
        await events.ready;
      },
      cancel() {
        void close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return caught(error);
  }
}
