import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadEnv } from "@gchopro/core";
import { raiseOpsAlert, resolveOpsAlert } from "./alerts-service.js";
import { getRedis } from "./redis.js";

const execFileAsync = promisify(execFile);
const LAST_KEY = "backup:last";
const RESTORE_KEY = "backup:restore-test";

export async function readBackup(): Promise<{
  lastAt: string | null;
  restoreTestAt: string | null;
}> {
  const lastAt = await getRedis().get(LAST_KEY);
  const restoreTestAt = await getRedis().get(RESTORE_KEY);
  return { lastAt, restoreTestAt };
}

export async function recordBackup(kind: "last" | "restore", at: Date): Promise<void> {
  await getRedis().set(kind === "last" ? LAST_KEY : RESTORE_KEY, at.toISOString());
}

async function runScript(script: string): Promise<void> {
  await execFileAsync("bash", [script], {
    cwd: process.cwd(),
    env: process.env,
    timeout: 15 * 60 * 1000,
  });
}

export async function runBackupJob(now = new Date()): Promise<"skipped" | "ok" | "failed"> {
  if (loadEnv().BACKUP_ENABLED !== true) return "skipped";
  try {
    await runScript("infra/backup/backup.sh");
    await recordBackup("last", now);
    await resolveOpsAlert("backup_failed");
    return "ok";
  } catch {
    await raiseOpsAlert({
      type: "backup_failed",
      severity: "critical",
      title: "Backup failed",
      dedupeKey: "backup_failed",
    });
    return "failed";
  }
}

export async function runRestoreTest(now = new Date()): Promise<"skipped" | "ok" | "failed"> {
  if (loadEnv().BACKUP_ENABLED !== true) return "skipped";
  try {
    await runScript("infra/backup/restore-test.sh");
    await recordBackup("restore", now);
    await raiseOpsAlert({
      type: "backup_restore_test",
      severity: "info",
      title: "Backup restore test succeeded",
      dedupeKey: "backup_restore_test",
    });
    await resolveOpsAlert("backup_failed");
    return "ok";
  } catch {
    await raiseOpsAlert({
      type: "backup_failed",
      severity: "critical",
      title: "Backup restore test failed",
      dedupeKey: "backup_failed",
    });
    return "failed";
  }
}
