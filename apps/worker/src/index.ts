import { randomUUID } from "node:crypto";
import { createLogger, loadEnv, redactForLog } from "@gchopro/core";
import { tickSubscriptions } from "@gchopro/db";

const env = loadEnv();
const requestId = randomUUID();
const logger = createLogger(env.LOG_LEVEL, { requestId });

logger.info(redactForLog({ phase: "m3" }), "worker started");

async function beat(): Promise<void> {
  try {
    const result = await tickSubscriptions();
    logger.info(redactForLog(result), "subscriptions ticked");
  } catch (error) {
    logger.error(
      { message: error instanceof Error ? error.message : "tick failed" },
      "subscription tick failed",
    );
  }
}

void beat();
const timer = setInterval(() => {
  void beat();
}, 60_000);

function stop(signal: string): void {
  clearInterval(timer);
  logger.info({ signal }, "worker stopping");
  process.exit(0);
}

process.on("SIGTERM", () => {
  stop("SIGTERM");
});
process.on("SIGINT", () => {
  stop("SIGINT");
});
