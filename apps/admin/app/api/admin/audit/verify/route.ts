import { COOKIE, apiData } from "@gchopro/core";
import { readAuditVerification } from "@gchopro/db";
import { caught, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return apiData(await readAuditVerification(await tokenFrom(COOKIE.admin)));
  } catch (error) {
    return caught(error);
  }
}
