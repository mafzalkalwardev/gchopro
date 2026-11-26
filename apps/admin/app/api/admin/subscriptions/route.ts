import { apiData } from "@gchopro/core";
import { listSubscriptions } from "@gchopro/db";
import { adminActor } from "@/lib/actor";
import { caught } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    await adminActor(request);
    const query = new URL(request.url).searchParams;
    const days = query.get("expiringWithinDays");
    const parsed = days === null ? undefined : Number(days);
    return apiData(
      await listSubscriptions({
        status: query.get("status") ?? undefined,
        expiringWithinDays: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
      }),
    );
  } catch (error) {
    return caught(error);
  }
}
