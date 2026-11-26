import { COOKIE } from "@gchopro/core";
import { openUserEvents, requireReady } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function eventName(line: string): string {
  try {
    const payload = JSON.parse(line) as { type?: unknown };
    if (
      payload.type === "message.status" ||
      payload.type === "message.received" ||
      payload.type === "notice.created" ||
      payload.type === "line.status"
    ) {
      return payload.type;
    }
  } catch {
    return "session.revoked";
  }
  return "session.revoked";
}

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
          controller.enqueue(encoder.encode(`event: ${eventName(line)}\ndata: ${line}\n\n`));
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
