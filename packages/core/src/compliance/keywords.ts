function fold(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en");
}

function boundary(value: string, needle: string): boolean {
  if (value === needle) return true;
  if (!value.startsWith(needle)) return false;
  const next = value.charAt(needle.length);
  if (next === "") return true;
  return /[\s\p{P}]/u.test(next);
}

export function matchingKeyword(body: string, keywords: readonly string[]): string | null {
  const folded = fold(body);
  for (const keyword of keywords) {
    const needle = fold(keyword);
    if (needle.length === 0) continue;
    if (boundary(folded, needle)) return keyword;
  }
  return null;
}

export function confirmationLanguage(body: string): "zh" | "en" {
  return /\p{Script=Han}/u.test(body) ? "zh" : "en";
}

export const POLICY_TEXT =
  "Messages may only be sent to recipients who have consented or have an existing relationship with the sender. Purchased or scraped lists are prohibited. Recipients can reply STOP or 退订 to opt out at any time. Operation must comply with local telecommunications regulations (for example the Pakistan Telecommunication Authority where applicable) and the terms of service of each carrier.";
