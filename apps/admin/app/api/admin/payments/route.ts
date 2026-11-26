import { apiData, loadEnv, paymentCreate } from "@gchopro/core";
import { listPayments, paymentsCsv, recordPayment } from "@gchopro/db";
import { adminActor } from "@/lib/actor";
import { caught, guardCsrf, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    await adminActor(request);
    const query = new URL(request.url).searchParams;
    const filter = { userId: query.get("userId") ?? undefined };
    if (query.get("format") === "csv") {
      return new Response(await paymentsCsv(filter), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="payments.csv"',
        },
      });
    }
    return apiData(await listPayments(filter));
  } catch (error) {
    return caught(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const denied = await guardCsrf(request, loadEnv().ADMIN_HOST);
    if (denied) return denied;
    const actor = await adminActor(request);
    const body = await readJson(request, paymentCreate);
    return apiData(await recordPayment(actor, body), 201);
  } catch (error) {
    return caught(error);
  }
}
