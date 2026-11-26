import { TZDate } from "@date-fns/tz";
import { addDays, addMonths, addWeeks, addYears } from "date-fns";

export type PlanUnit = "day" | "week" | "month" | "year";

export function timezoneValid(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function addPlan(start: Date, unit: PlanUnit, quantity: number, timeZone: string): Date {
  const zoned = new TZDate(start.getTime(), timeZone);
  const shifted =
    unit === "day"
      ? addDays(zoned, quantity)
      : unit === "week"
        ? addWeeks(zoned, quantity)
        : unit === "month"
          ? addMonths(zoned, quantity)
          : addYears(zoned, quantity);
  return new Date(shifted.getTime());
}

export function localDay(instant: Date, timeZone: string): string {
  const zoned = new TZDate(instant.getTime(), timeZone);
  const month = String(zoned.getMonth() + 1).padStart(2, "0");
  const day = String(zoned.getDate()).padStart(2, "0");
  return `${String(zoned.getFullYear())}-${month}-${day}`;
}

export function localHour(instant: Date, timeZone: string): number {
  return new TZDate(instant.getTime(), timeZone).getHours();
}
