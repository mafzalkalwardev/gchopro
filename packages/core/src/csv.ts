export function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const escaped = text.split('"').join('""');
  const guarded = /^[=+\-@\t\r]/u.test(text) ? `'${escaped}` : escaped;
  return `"${guarded}"`;
}

export function csvLine(cells: ReadonlyArray<string | number | null>): string {
  return cells.map((cell) => csvCell(cell)).join(",");
}
