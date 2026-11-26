export type MaintenanceClock = {
  day: string;
  hour: number;
  weekday: string;
};

export type MaintenanceDue = {
  day: string;
  retention: boolean;
  backup: boolean;
  restoreTest: boolean;
};

export function maintenanceClock(now: Date, timeZone: string): MaintenanceClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  const hourText = map.get("hour") ?? "0";
  return {
    day: `${map.get("year") ?? "0000"}-${map.get("month") ?? "01"}-${map.get("day") ?? "01"}`,
    hour: Number(hourText === "24" ? "0" : hourText),
    weekday: map.get("weekday") ?? "",
  };
}

/** The worker tick is not aligned to the clock, so a job is due for the whole hour. */
export function maintenanceDue(now: Date, timeZone: string): MaintenanceDue {
  const clock = maintenanceClock(now, timeZone);
  return {
    day: clock.day,
    retention: clock.hour === 3,
    backup: clock.hour === 2,
    restoreTest: clock.weekday === "Sun" && clock.hour === 4,
  };
}
