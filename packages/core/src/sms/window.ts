import { TZDate } from "@date-fns/tz";

export type WindowPolicy = {
  start: string;
  end: string;
  days: readonly number[];
  timeZone: string;
};

function clock(value: string): { hours: number; minutes: number; seconds: number } {
  const [hours, minutes, seconds] = value.split(":");
  return {
    hours: Number(hours ?? 0),
    minutes: Number(minutes ?? 0),
    seconds: Number(seconds ?? 0),
  };
}

function isoDay(zoned: TZDate): number {
  const day = zoned.getDay();
  return day === 0 ? 7 : day;
}

function atLocal(
  year: number,
  month: number,
  date: number,
  hours: number,
  minutes: number,
  seconds: number,
  timeZone: string,
): Date {
  return new Date(new TZDate(year, month, date, hours, minutes, seconds, timeZone).getTime());
}

export function windowState(now: Date, policy: WindowPolicy): { open: boolean; nextOpen: Date } {
  const zoned = new TZDate(now.getTime(), policy.timeZone);
  const start = clock(policy.start);
  const end = clock(policy.end);
  const today = isoDay(zoned);
  const minutesNow = zoned.getHours() * 3600 + zoned.getMinutes() * 60 + zoned.getSeconds();
  const startSeconds = start.hours * 3600 + start.minutes * 60 + start.seconds;
  const endSeconds = end.hours * 3600 + end.minutes * 60 + end.seconds;
  const allowed = policy.days.includes(today);
  const open = allowed && minutesNow >= startSeconds && minutesNow < endSeconds;
  if (open) {
    return {
      open: true,
      nextOpen: atLocal(
        zoned.getFullYear(),
        zoned.getMonth(),
        zoned.getDate(),
        start.hours,
        start.minutes,
        start.seconds,
        policy.timeZone,
      ),
    };
  }
  for (let offset = 0; offset < 8; offset += 1) {
    const probe = new TZDate(now.getTime(), policy.timeZone);
    probe.setDate(probe.getDate() + offset);
    if (!policy.days.includes(isoDay(probe))) continue;
    const opening = atLocal(
      probe.getFullYear(),
      probe.getMonth(),
      probe.getDate(),
      start.hours,
      start.minutes,
      start.seconds,
      policy.timeZone,
    );
    if (opening.getTime() > now.getTime()) return { open: false, nextOpen: opening };
  }
  return { open: false, nextOpen: new Date(now.getTime() + 24 * 60 * 60 * 1000) };
}
