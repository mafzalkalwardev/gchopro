import { apiData } from "@gchopro/core";
import { listSims } from "@gchopro/db";
import { adminActor } from "@/lib/actor";
import { caught } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    await adminActor(request);
    const url = new URL(request.url);
    const assigned = url.searchParams.get("assigned");
    return apiData(
      await listSims({
        health: url.searchParams.get("health") ?? undefined,
        deviceId: url.searchParams.get("deviceId") ?? undefined,
        assigned: assigned === "true" ? true : assigned === "false" ? false : undefined,
      }),
    );
  } catch (error) {
    return caught(error);
  }
}
