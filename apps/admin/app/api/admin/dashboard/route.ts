import { apiData } from "@gchopro/core";
import { dashboard } from "@gchopro/db";
import { adminActor } from "@/lib/actor";
import { caught } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    await adminActor(request);
    return apiData(await dashboard());
  } catch (error) {
    return caught(error);
  }
}
