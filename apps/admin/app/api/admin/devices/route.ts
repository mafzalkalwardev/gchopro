import { apiData } from "@gchopro/core";
import { listDevices } from "@gchopro/db";
import { caught } from "@/lib/http";
import { adminActor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    await adminActor(request);
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    return apiData(await listDevices(status));
  } catch (error) {
    return caught(error);
  }
}
