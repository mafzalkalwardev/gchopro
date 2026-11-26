import type { Lang } from "./types.js";

const HAN = /\p{Script=Han}/u;

/** More than 30% Han characters means Chinese. Anything else is English. */
export function detectLanguage(text: string): Lang {
  const glyphs = [...text].filter((char) => char.trim().length > 0);
  if (glyphs.length === 0) return "en";
  let han = 0;
  for (const char of glyphs) if (HAN.test(char)) han += 1;
  return han / glyphs.length > 0.3 ? "zh" : "en";
}

export function characterCount(text: string): number {
  return [...text].length;
}
