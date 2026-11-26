const BASIC = new Set([
  "@",
  "£",
  "$",
  "¥",
  "è",
  "é",
  "ù",
  "ì",
  "ò",
  "Ç",
  "\n",
  "Ø",
  "ø",
  "\r",
  "Å",
  "å",
  "Δ",
  "_",
  "Φ",
  "Γ",
  "Λ",
  "Ω",
  "Π",
  "Ψ",
  "Σ",
  "Θ",
  "Ξ",
  "\u001b",
  "Æ",
  "æ",
  "ß",
  "É",
  " ",
  "!",
  '"',
  "#",
  "¤",
  "%",
  "&",
  "'",
  "(",
  ")",
  "*",
  "+",
  ",",
  "-",
  ".",
  "/",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  ":",
  ";",
  "<",
  "=",
  ">",
  "?",
  "¡",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "Ä",
  "Ö",
  "Ñ",
  "Ü",
  "§",
  "¿",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "ä",
  "ö",
  "ñ",
  "ü",
  "à",
]);

const EXTENSION = new Set(["^", "{", "}", "\\", "[", "~", "]", "|", "€", "\f"]);

export const MAX_SEGMENTS = 10;

export type SegmentCount = {
  encoding: "gsm7" | "ucs2";
  units: number;
  segments: number;
  perSegment: number;
  remainingInSegment: number;
};

function pack(
  encoding: "gsm7" | "ucs2",
  units: number,
  segments: number,
  perSegment: number,
  remainingInSegment: number,
): SegmentCount {
  return { encoding, units, segments, perSegment, remainingInSegment };
}

function gsmCosts(text: string): number[] | null {
  const costs: number[] = [];
  for (const char of text) {
    if (BASIC.has(char)) costs.push(1);
    else if (EXTENSION.has(char)) costs.push(2);
    else return null;
  }
  return costs;
}

function walk(
  costs: readonly number[],
  budgetSize: number,
): { segments: number; remaining: number } {
  if (costs.length === 0) return { segments: 1, remaining: budgetSize };
  let segments = 1;
  let budget = budgetSize;
  for (const cost of costs) {
    if (cost > budget) {
      segments += 1;
      budget = budgetSize;
    }
    budget -= cost;
  }
  return { segments, remaining: budget };
}

function ucs2Units(text: string): number[] {
  const units: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const next = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
    if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      units.push(2);
      index += 1;
    } else {
      units.push(1);
    }
  }
  return units;
}

export function countSegments(text: string): SegmentCount {
  const gsm = gsmCosts(text);
  if (gsm !== null) {
    const units = gsm.reduce((sum, cost) => sum + cost, 0);
    if (units <= 160) return pack("gsm7", units, 1, 160, 160 - units);
    const walked = walk(gsm, 153);
    return pack("gsm7", units, walked.segments, 153, walked.remaining);
  }
  const unitsList = ucs2Units(text);
  const units = unitsList.reduce((sum, cost) => sum + cost, 0);
  if (units <= 70) return pack("ucs2", units, 1, 70, 70 - units);
  const walked = walk(unitsList, 67);
  return pack("ucs2", units, walked.segments, 67, walked.remaining);
}

export function isTooLong(count: SegmentCount): boolean {
  return count.segments > MAX_SEGMENTS;
}

export function gsmBasicSize(): number {
  return BASIC.size;
}
