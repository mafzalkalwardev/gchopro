import { AppError, SAFE_TEXT, apiFromError, hostnameOf, loadEnv } from "@gchopro/core";
import { authenticateDevice, consumeLimit } from "@gchopro/db";
import type { ZodType } from "zod";
import { readJson } from "@/lib/http";

export function assertGateway(request: Request): void {
  const host = hostnameOf(request.headers.get("host") ?? "");
  if (host !== loadEnv().GATEWAY_HOST) {
    throw new AppError(404, "not_found", SAFE_TEXT.not_found);
  }
}

export function assertProtocol(request: Request): void {
  const version = request.headers.get("x-gateway-protocol");
  if (version === "1") throw new AppError(426, "upgrade_required", SAFE_TEXT.upgrade_required);
  if (version !== "2") throw new AppError(400, "invalid_body", SAFE_TEXT.invalid_body);
}

export function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, presented = ""] = header.split(" ");
  if (scheme !== "Bearer" || !/^[A-Fa-f0-9]{64}$/.test(presented)) {
    throw new AppError(401, "device_revoked", SAFE_TEXT.device_revoked);
  }
  return presented;
}

export function deviceJson(body: unknown, rotate: boolean, status = 200): Response {
  const headers = new Headers();
  if (rotate) headers.set("x-gateway-rotate", "1");
  return Response.json(body, { status, headers });
}

export async function withDevice(
  request: Request,
  deviceId: string,
  run: (device: Awaited<ReturnType<typeof authenticateDevice>>["device"]) => Promise<unknown>,
): Promise<Response> {
  try {
    assertGateway(request);
    assertProtocol(request);
    const auth = await authenticateDevice(deviceId, bearer(request));
    await consumeLimit("deviceApi", deviceId);
    return deviceJson(await run(auth.device), auth.rotate);
  } catch (error) {
    return apiFromError(error);
  }
}

export async function readDeviceJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  return readJson(request, schema);
}
