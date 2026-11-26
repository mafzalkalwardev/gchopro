export type StoredSimIdentity = {
  id: string;
  subscriptionId: number;
  slotIndex: number;
  carrierName: string | null;
  phoneNumberHash: string | null;
  retired: boolean;
};

export type ReportedSimIdentity = {
  subscriptionId: number;
  slotIndex: number;
  carrierName: string | null;
  phoneNumberHash: string | null;
};

export type ReconcilePlan = {
  matched: { id: string; reportIndex: number }[];
  reactivated: { id: string; reportIndex: number }[];
  created: number[];
  missing: string[];
};

function sameText(left: string | null, right: string | null): boolean {
  return left === right;
}

/**
 * Match an open SIM by subscription, then by slot, carrier, and a known number.
 * A blank number is not an identity. Retired rows stay retired.
 */
export function reconcileSims(
  stored: readonly StoredSimIdentity[],
  reported: readonly ReportedSimIdentity[],
): ReconcilePlan {
  const open = stored.filter((row) => !row.retired);
  const used = new Set<string>();
  const matched: { id: string; reportIndex: number }[] = [];
  const reactivated: { id: string; reportIndex: number }[] = [];
  const created: number[] = [];
  for (const [index, report] of reported.entries()) {
    let found = open.find(
      (row) => !used.has(row.id) && row.subscriptionId === report.subscriptionId,
    );
    if (found === undefined && report.phoneNumberHash !== null) {
      found = open.find(
        (row) =>
          !used.has(row.id) &&
          row.slotIndex === report.slotIndex &&
          sameText(row.carrierName, report.carrierName) &&
          row.phoneNumberHash === report.phoneNumberHash,
      );
    }
    if (found !== undefined) {
      used.add(found.id);
      matched.push({ id: found.id, reportIndex: index });
      continue;
    }
    const retired = stored.find(
      (row) =>
        row.retired &&
        !used.has(row.id) &&
        (row.subscriptionId === report.subscriptionId ||
          (report.phoneNumberHash !== null && row.phoneNumberHash === report.phoneNumberHash)),
    );
    if (retired !== undefined) {
      used.add(retired.id);
      reactivated.push({ id: retired.id, reportIndex: index });
      continue;
    }
    created.push(index);
  }
  return {
    matched,
    reactivated,
    created,
    missing: open.filter((row) => !used.has(row.id)).map((row) => row.id),
  };
}
