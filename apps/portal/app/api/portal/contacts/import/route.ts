import { AppError, COOKIE, SAFE_TEXT, apiData, loadEnv } from "@gchopro/core";
import { importContacts } from "@gchopro/db";
import { caught, guardCsrf, tokenFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvText(type: string, body: string): string {
  if (!type.includes("multipart/form-data")) return body;
  const marker = body.indexOf("name,number");
  const start = marker >= 0 ? marker : body.indexOf("\r\n\r\n");
  if (start < 0) return body;
  const slice = marker >= 0 ? body.slice(start) : body.slice(start + 4);
  const boundary = slice.search(/\r\n--/u);
  return boundary >= 0 ? slice.slice(0, boundary) : slice;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    const body = await request.text();
    if (body.length > 1_000_000) throw new AppError(413, "invalid_body", SAFE_TEXT.invalid_body);
    const csv = csvText(request.headers.get("content-type") ?? "", body);
    return apiData(await importContacts(await tokenFrom(COOKIE.portal), csv));
  } catch (error) {
    return caught(error);
  }
}
