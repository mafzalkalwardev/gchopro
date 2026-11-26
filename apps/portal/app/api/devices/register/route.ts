import { AppError, SAFE_TEXT, apiFromError, registerBody } from "@gchopro/core";
import { registerDevice } from "@gchopro/db";
import { assertGateway, readDeviceJson } from "@/lib/device";
import { requestIp } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    assertGateway(request);
    const body = await readDeviceJson(request, registerBody);
    const ip = requestIp(request);
    if (ip === null) throw new AppError(400, "invalid_body", SAFE_TEXT.invalid_body);
    return Response.json(
      await registerDevice({
        code: body.code,
        name: body.name,
        protocolVersion: body.protocolVersion,
        appVersion: body.appVersion,
        model: body.model,
        androidSdk: body.androidSdk,
        ip,
      }),
    );
  } catch (error) {
    return apiFromError(error);
  }
}
