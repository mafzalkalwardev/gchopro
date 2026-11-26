import { randomUUID } from "node:crypto";
import {
  KILL_POLL_MS,
  createLogger,
  loadEnv,
  maintenanceDue,
  redactForLog,
  simQueueName,
} from "@gchopro/core";
import {
  claimTranslationJobs,
  deliverPendingAlerts,
  dueWork,
  getDb,
  getRedis,
  holdUnhealthy,
  killSwitchOn,
  processSend,
  promoteScheduled,
  purgeRetention,
  recordWorkerBeat,
  rollupStats,
  runBackupJob,
  runRestoreTest,
  simRuntime,
  sweepDeviceAlerts,
  sweepLeases,
  tickSubscriptions,
  translateQueued,
} from "@gchopro/db";
import { DelayedError, Queue, Worker, type Job } from "bullmq";

const env = loadEnv();
const requestId = randomUUID();
const logger = createLogger(env.LOG_LEVEL, { requestId });
const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null };

type Lane = { queue: Queue; worker: Worker };

const lanes = new Map<string, Lane>();

logger.info(redactForLog({ phase: "m8" }), "worker started");

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
  await recordWorkerBeat();
  await sweepDeviceAlerts();
  await deliverPendingAlerts();
}

async function watchStats(): Promise<void> {
  await rollupStats();
}

async function onceToday(kind: string, day: string, task: () => Promise<void>): Promise<void> {
  const key = `ops:${kind}:${day}`;
  const claimed = await getRedis().set(key, "1", "EX", 172_800, "NX");
  if (claimed !== "OK") return;
  try {
    await task();
  } catch (error) {
    await getRedis().del(key);
    throw error;
  }
}

async function watchMaintenance(): Promise<void> {
  const due = maintenanceDue(new Date(), "Asia/Karachi");
  if (due.retention)
    await onceToday("retention", due.day, async () => {
      await purgeRetention();
    });
  if (due.backup)
    await onceToday("backup", due.day, async () => {
      await runBackupJob();
    });
  if (due.restoreTest)
    await onceToday("restore", due.day, async () => {
      await runRestoreTest();
    });
}

const translateQueue = new Queue("translate", { connection });
const translateWorker = new Worker(
  "translate",
  async (job: Job<{ messageId: string; role: "outbound_original" | "inbound_display" }>) => {
    await translateQueued(job.data.messageId, job.data.role);
  },
  { connection, concurrency: 4 },
);

async function watchTranslations(): Promise<void> {
  const jobs = await claimTranslationJobs(20);
  for (const job of jobs) {
    try {
      await translateQueue.add("translate", job, {
        jobId: `${job.role}-${job.messageId}`,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 1,
      });
    } catch {
      // This message is already waiting on the translate queue.
    }
  }
}

void watchHealth();
void watchTranslations();
void watchStats();
void watchMaintenance();
const healthWatch = setInterval(() => {
  void watchHealth().catch((error: unknown) => {
    logger.error(
      { message: error instanceof Error ? error.message : "health sweep failed" },
      "health sweep failed",
    );
  });
}, 30_000);
const translationWatch = setInterval(() => {
  void watchTranslations().catch((error: unknown) => {
    logger.error(
      { message: error instanceof Error ? error.message : "translation sweep failed" },
      "translation sweep failed",
    );
  });
}, 2000);
const statsWatch = setInterval(() => {
  void watchStats().catch((error: unknown) => {
    logger.error(
      { message: error instanceof Error ? error.message : "stats rollup failed" },
      "stats rollup failed",
    );
  });
}, 300_000);
const maintenanceWatch = setInterval(() => {
  void watchMaintenance().catch((error: unknown) => {
    logger.error(
      { message: error instanceof Error ? error.message : "maintenance failed" },
      "maintenance failed",
    );
  });
}, 60_000);

function stop(signal: string): void {
  clearInterval(subscriptions);
  clearInterval(pacing);
  clearInterval(killWatch);
  clearInterval(healthWatch);
  clearInterval(translationWatch);
  clearInterval(statsWatch);
  clearInterval(maintenanceWatch);
  void translateWorker.close();
  void translateQueue.close();
  logger.info({ signal }, "worker stopping");
  process.exit(0);
}

process.on("SIGTERM", () => {
  stop("SIGTERM");
});
process.on("SIGINT", () => {
  stop("SIGINT");
});
