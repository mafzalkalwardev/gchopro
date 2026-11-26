export function matchingKeyword(body: string, keywords: readonly string[]): string | null {
  const trimmed = body.trim().toLowerCase();
  for (const keyword of keywords) {
    if (trimmed === keyword.trim().toLowerCase()) return keyword;
  }
  return null;
}
