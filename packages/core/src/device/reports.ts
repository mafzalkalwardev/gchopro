export type AggregatedStatus = "dispatched" | "sent" | "delivered" | "failed";

export function aggregateReport(input: {
  partCount: number;
  sent: number;
  failed: number;
  delivered: number;
}): AggregatedStatus {
  if (input.failed > 0) return "failed";
  if (input.partCount > 0 && input.delivered >= input.partCount) return "delivered";
  if (input.partCount > 0 && input.sent >= input.partCount) return "sent";
  return "dispatched";
}

export function testNumberAllowed(e164: string, configured: string | undefined): boolean {
  if (configured === undefined) return false;
  const allowed = configured
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return allowed.includes(e164);
}
