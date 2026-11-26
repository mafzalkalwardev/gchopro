import { randomUUID } from "node:crypto";
import { KILL_POLL_MS, createLogger, loadEnv, redactForLog, simQueueName } from "@gchopro/core";
import {
  deliverPendingAlerts,
  dueWork,
  getDb,
  holdUnhealthy,
  killSwitchOn,
  processSend,
  promoteScheduled,
  simRuntime,
  sweepDeviceAlerts,
  sweepLeases,
  tickSubscriptions,
} from "@gchopro/db";
import { DelayedError, Queue, Worker, type Job } from "bullmq";

const env = loadEnv();
const requestId = randomUUID();
const logger = createLogger(env.LOG_LEVEL, { requestId });
const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null };

type Lane = { queue: Queue; worker: Worker };

const lanes = new Map<string, Lane>();

logger.info(redactForLog({ phase: "m5" }), "worker started");

async function sendJob(job: Job<{ messageId: string }>): Promise<void> {
  const result = await processSend(job.data.messageId);
  if (result.kind === "hold" || result.kind === "wait") {
    await job.moveToDelayed(Date.now() + result.delayMs);
    throw new DelayedError();
  }
}

async function laneFor(simId: string, running: boolean): Promise<Lane> {
  const existing = lanes.get(simId);
  const lane = existing ?? {
    queue: new Queue(simQueueName(simId), { connection }),
    worker: new Worker(simQueueName(simId), sendJob, { connection, concurrency: 1 }),
  };
  if (!existing) lanes.set(simId, lane);
  if (running) await lane.worker.resume();
  else await lane.worker.pause();
  return lane;
}

async function pump(): Promise<void> {
  const killed = await killSwitchOn(getDb());
  await promoteScheduled();
  await sweepLeases();
  const runtime = await simRuntime();
  for (const sim of runtime) {
    const running = sim.assignable && !killed;
    await laneFor(sim.simId, running);
    if (!sim.assignable) await holdUnhealthy(sim.simId);
  }
  if (killed) return;
  const due = await dueWork();
  for (const item of due) {
    const sim = runtime.find((row) => row.simId === item.simId);
    if (sim?.assignable !== true) continue;
    const lane = lanes.get(item.simId);
    if (lane === undefined) continue;
    try {
      await lane.queue.add(
        "send",
        { messageId: item.id },
        { jobId: item.id, removeOnComplete: true },
      );
    } catch {
      // The job is already waiting on this SIM queue.
    }
  }
}

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

async function watchKill(): Promise<void> {
  const killed = await killSwitchOn(getDb());
  for (const lane of lanes.values()) {
    if (killed) await lane.worker.pause();
    else await lane.worker.resume();
  }
}

void beat();
void pump();
const subscriptions = setInterval(() => {
  void beat();
}, 60_000);
const pacing = setInterval(() => {
  void pump().catch((error: unknown) => {
    logger.error(
      { message: error instanceof Error ? error.message : "pump failed" },
      "pacing pump failed",
    );
  });
}, 2000);
const killWatch = setInterval(() => {
  void watchKill().catch(() => undefined);
}, KILL_POLL_MS);

async function watchHealth(): Promise<void> {
  await sweepDeviceAlerts();
  await deliverPendingAlerts();
}

void watchHealth();
const healthWatch = setInterval(() => {
  void watchHealth().catch((error: unknown) => {
    logger.error(
      { message: error instanceof Error ? error.message : "health sweep failed" },
      "health sweep failed",
    );
  });
}, 30_000);

function stop(signal: string): void {
  clearInterval(subscriptions);
  clearInterval(pacing);
  clearInterval(killWatch);
  clearInterval(healthWatch);
  logger.info({ signal }, "worker stopping");
  process.exit(0);
}

process.on("SIGTERM", () => {
  stop("SIGTERM");
});
process.on("SIGINT", () => {
  stop("SIGINT");
});
