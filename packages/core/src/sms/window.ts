export type WindowPolicy = {
  start: string;
  end: string;
  days: readonly number[];
  timeZone: string;
};

export function windowState(now: Date, policy: WindowPolicy): { open: boolean; nextOpen: Date } {
  void policy;
  return { open: true, nextOpen: now };
}
