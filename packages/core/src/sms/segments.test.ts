import { describe, expect, it } from "vitest";
import { countSegments, gsmBasicSize, isTooLong } from "./segments.js";

describe("countSegments", () => {
  it("uses the 128-character GSM-7 set and the 160/153 boundary", () => {
    expect(gsmBasicSize()).toBe(128);
    expect(countSegments("a".repeat(160))).toMatchObject({
      encoding: "gsm7",
      units: 160,
      segments: 1,
      remainingInSegment: 0,
    });
    expect(countSegments("a".repeat(161))).toMatchObject({
      encoding: "gsm7",
      units: 161,
      segments: 2,
      perSegment: 153,
      remainingInSegment: 145,
    });
    expect(countSegments(`${"a".repeat(153)}${"a".repeat(153)}`).segments).toBe(2);
  });

  it("keeps an extension character on one segment", () => {
    const atBoundary = `${"a".repeat(152)}€${"a".repeat(8)}`;
    const count = countSegments(atBoundary);
    expect(count.encoding).toBe("gsm7");
    expect(count.units).toBe(162);
    expect(count.segments).toBe(2);
    expect(countSegments("€").units).toBe(2);
    expect(countSegments("\f").units).toBe(2);
  });

  it("counts UTF-16 units and does not split an emoji", () => {
    expect(countSegments("你".repeat(70))).toMatchObject({
      encoding: "ucs2",
      units: 70,
      segments: 1,
    });
    expect(countSegments("你".repeat(71))).toMatchObject({
      encoding: "ucs2",
      units: 71,
      segments: 2,
      perSegment: 67,
      remainingInSegment: 63,
    });
    expect(countSegments("😀".repeat(35))).toMatchObject({ units: 70, segments: 1 });
    const emoji = countSegments("😀".repeat(36));
    expect(emoji.units).toBe(72);
    expect(emoji.segments).toBe(2);
    expect(emoji.remainingInSegment).toBe(61);
    expect(isTooLong(countSegments("你".repeat(671)))).toBe(true);
  });
});
