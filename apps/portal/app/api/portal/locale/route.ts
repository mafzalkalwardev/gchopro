import { z } from "zod";
import { requireHost } from "@gchopro/core";
import { cookies } from "next/headers";
import { allowFormPost, caught, guardCsrf, readJson, redirectNext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ locale: z.enum(["en", "zh-CN"]) });
const year = 60 * 60 * 24 * 365;

async function remember(locale: "en" | "zh-CN"): Promise<void> {
  (await cookies()).set("gcho_locale", locale, {
    path: "/",
    sameSite: "lax",
    secure: true,
    maxAge: year,
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const host = requireHost("PORTAL_HOST");
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const denied = await guardCsrf(request, host);
      if (denied) return denied;
      const input = await readJson(request, body);
      await remember(input.locale);
      return new Response(null, { status: 204 });
    }
    const denied = await allowFormPost(request, host);
    if (denied) return denied;
    const form = await request.formData();
    const input = body.safeParse({ locale: form.get("locale") });
    if (!input.success) return new Response(null, { status: 400 });
    await remember(input.data.locale);
    return redirectNext(request, form, "/login");
  } catch (error) {
    return caught(error);
  }
}
