import { randomUUID } from "node:crypto";
import { createLogger, loadEnv, redactForLog } from "@gchopro/core";

const env = loadEnv();
const requestId = randomUUID();
const logger = createLogger(env.LOG_LEVEL, { requestId });

logger.info(redactForLog({ phase: "m0" }), "worker idle");

function stop(signal: string): void {
  logger.info({ signal }, "worker stopping");
  process.exit(0);
}

process.on("SIGTERM", () => {
  stop("SIGTERM");
});
process.on("SIGINT", () => {
  stop("SIGINT");
});

await new Promise(() => undefined);
