import { z } from "zod";
import { loadEnv } from "@gchopro/core";
import { cookies } from "next/headers";
import { caught, guardCsrf, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ locale: z.enum(["en", "zh-CN"]) });

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().PORTAL_HOST);
    if (denied) return denied;
    const input = await readJson(request, body);
    (await cookies()).set("gcho_locale", input.locale, {
      path: "/",
      sameSite: "lax",
      secure: true,
      maxAge: 60 * 60 * 24 * 365,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return caught(error);
  }
}
