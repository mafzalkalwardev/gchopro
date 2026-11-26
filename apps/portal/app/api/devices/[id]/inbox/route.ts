import { inboxBody } from "@gchopro/core";
import { ingestInbox } from "@gchopro/db";
import { readDeviceJson, withDevice } from "@/lib/device";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return withDevice(request, id, async (device) => {
    const body = await readDeviceJson(request, inboxBody);
    return ingestInbox(device.id, body.messages);
  });
}
