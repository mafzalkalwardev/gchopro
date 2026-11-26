import { describe, expect, it } from "vitest";
import { csvCell, parseContactCsv } from "./csv.js";

describe("contact csv", () => {
  it("rejects a row without consent and keeps a quoted comma", () => {
    const parsed = parseContactCsv(
      'name,number,consent_source,consent_note,consent_at,tags\n"Ada, A",+923001110000,verbal,desk,2026-06-01T00:00:00Z,vip\nBob,+923001110001,,missing,,\n',
    );
    expect(parsed.accepted).toHaveLength(1);
    expect(parsed.accepted[0]?.name).toBe("Ada, A");
    expect(parsed.rejected).toEqual([{ row: 3, reason: "consent_source" }]);
  });

  it("escapes a formula when the row is exported later", () => {
    const parsed = parseContactCsv("name,number,consent_source\n=cmd,+923001110002,written\n");
    expect(parsed.accepted[0]?.name).toBe("=cmd");
    expect(csvCell(parsed.accepted[0]?.name ?? "")).toBe(`"'=cmd"`);
  });
});
