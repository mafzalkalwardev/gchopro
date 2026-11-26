const VARIABLE = /\{([a-z0-9_]+)\}/gu;

export function renderTemplate(
  body: string,
  values: Readonly<Record<string, string | undefined>>,
): { ok: true; text: string } | { ok: false; missing: string[] } {
  const table = new Map(Object.entries(values));
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(VARIABLE)) {
    const name = match[1] ?? "";
    if (seen.has(name)) continue;
    seen.add(name);
    if (!table.has(name)) missing.push(name);
  }
  if (missing.length > 0) return { ok: false, missing };
  const text = body.replace(VARIABLE, (_match, name: string) => table.get(name) ?? "");
  return { ok: true, text };
}

export function applySignature(
  body: string,
  signature: { enabled: boolean; text: string },
): string {
  if (!signature.enabled || signature.text.trim().length === 0) return body;
  return `${body}\n— ${signature.text.trim()}`;
}

export function contentBlocked(
  body: string,
  rules: { blockedKeywords: readonly string[]; blockUrls: boolean },
): boolean {
  const haystack = body.toLowerCase();
  for (const keyword of rules.blockedKeywords) {
    const needle = keyword.trim().toLowerCase();
    if (needle.length > 0 && haystack.includes(needle)) return true;
  }
  if (!rules.blockUrls) return false;
  return haystack.includes("http://") || haystack.includes("https://");
}
