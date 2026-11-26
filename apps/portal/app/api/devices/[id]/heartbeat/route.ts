import { heartbeatBody } from "@gchopro/core";
import { recordHeartbeat } from "@gchopro/db";
import { readDeviceJson, withDevice } from "@/lib/device";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return withDevice(request, id, async (device) =>
    recordHeartbeat(device, await readDeviceJson(request, heartbeatBody)),
  );
}
