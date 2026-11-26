export function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const escaped = text.split('"').join('""');
  const guarded = /^[=+\-@\t\r]/u.test(text) ? `'${escaped}` : escaped;
  return `"${guarded}"`;
}

export function csvLine(cells: ReadonlyArray<string | number | null>): string {
  return cells.map((cell) => csvCell(cell)).join(",");
}

const CONSENT = new Set([
  "existing_customer",
  "verbal",
  "written",
  "web_form",
  "imported_with_consent",
  "other",
]);

export type ContactCsvRow = {
  name: string;
  number: string;
  consentSource: string;
  consentNote: string;
  consentAt: string;
  tags: string[];
};

export function parseContactCsv(text: string): {
  accepted: ContactCsvRow[];
  rejected: { row: number; reason: string }[];
} {
  const table = parseCsv(text);
  const accepted: ContactCsvRow[] = [];
  const rejected: { row: number; reason: string }[] = [];
  table.slice(1, 5001).forEach((cells, index) => {
    const row = index + 2;
    const name = cells[0]?.trim() ?? "";
    const number = cells[1]?.trim() ?? "";
    const consentSource = cells[2]?.trim() ?? "";
    if (name.length === 0 && number.length === 0) return;
    if (number.length === 0) {
      rejected.push({ row, reason: "number" });
      return;
    }
    if (!CONSENT.has(consentSource)) {
      rejected.push({ row, reason: "consent_source" });
      return;
    }
    accepted.push({
      name,
      number,
      consentSource,
      consentNote: cells[3]?.trim() ?? "",
      consentAt: cells[4]?.trim() ?? "",
      tags: (cells[5] ?? "")
        .split("|")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    });
  });
  if (table.length > 5001) rejected.push({ row: 5002, reason: "too_many_rows" });
  return { accepted, rejected };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
