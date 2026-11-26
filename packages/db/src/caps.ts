import { CAPS_LUA, type CapCounts } from "@gchopro/core";
import { getRedis } from "./redis.js";

export type CapScope = "u" | "s";

function keys(scope: CapScope, id: string): [string, string, string, string] {
  const prefix = scope === "u" ? `rl:u:${id}` : `rl:s:${id}`;
  return [`${prefix}:m`, `${prefix}:h`, `${prefix}:d`, `${prefix}:seg`];
}

export type CapRead = {
  ok: boolean;
  reason: string;
  counts: CapCounts;
};

function parsed(raw: unknown): CapRead {
  const empty = { minute: 0, hour: 0, day: 0, segments: 0 };
  if (!Array.isArray(raw)) return { ok: true, reason: "ok", counts: empty };
  const values = raw.map((item) => item);
  const ok = Number(values[0] ?? 0) === 1;
  return {
    ok,
    reason: String(values[1] ?? "ok"),
    counts: {
      minute: Number(values[2] ?? 0),
      hour: Number(values[3] ?? 0),
      day: Number(values[4] ?? 0),
      segments: Number(values[5] ?? 0),
    },
  };
}

async function evalCaps(
  scope: CapScope,
  id: string,
  input: {
    now: number;
    perMinute: number;
    perHour: number;
    perDay: number;
    segmentsPerDay: number;
    segments: number;
    member: string;
    mode: "read" | "check" | "commit";
  },
): Promise<CapRead> {
  const [minute, hour, day, segments] = keys(scope, id);
  const raw = await getRedis().eval(
    CAPS_LUA,
    4,
    minute,
    hour,
    day,
    segments,
    String(input.now),
    String(input.perMinute),
    String(input.perHour),
    String(input.perDay),
    String(input.segmentsPerDay),
    String(input.segments),
    input.member,
    input.mode,
  );
  return parsed(raw);
}

export async function readCaps(scope: CapScope, id: string, now = Date.now()): Promise<CapCounts> {
  const result = await evalCaps(scope, id, {
    now,
    perMinute: 1,
    perHour: 1,
    perDay: 1,
    segmentsPerDay: 1,
    segments: 0,
    member: "read",
    mode: "read",
  });
  return result.counts;
}

export async function commitCaps(
  scope: CapScope,
  id: string,
  input: {
    now: number;
    perMinute: number;
    perHour: number;
    perDay: number;
    segmentsPerDay: number;
    segments: number;
    member: string;
  },
): Promise<CapRead> {
  return evalCaps(scope, id, { ...input, mode: "commit" });
}

export async function clearCaps(scope: CapScope, id: string): Promise<void> {
  const names = keys(scope, id);
  await getRedis().del(...names);
}
