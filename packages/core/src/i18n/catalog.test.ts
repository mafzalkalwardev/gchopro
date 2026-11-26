import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalogKeys, screenCopy } from "./catalog.js";

function pages(dir: string): string[] {
  const found: string[] = [];
  // The walk stays inside apps/admin/app and apps/portal/app.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (statSync(full).isDirectory()) found.push(...pages(full));
    else if (name === "page.tsx") found.push(full);
  }
  return found;
}

describe("interface catalogs", () => {
  it("gives every English screen a Chinese string", () => {
    for (const key of catalogKeys()) {
      const english = screenCopy("en", key);
      const chinese = screenCopy("zh-CN", key);
      expect(english.length).toBeGreaterThan(0);
      expect(chinese.length).toBeGreaterThan(0);
      expect(chinese).not.toBe(key);
    }
    expect(screenCopy("zh-CN", "inbox")).toBe("收件箱");
    expect(screenCopy("en", "portal_login")).toBe("Portal sign-in");
  });

  it("is used by every admin and portal screen", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    const files = [
      ...pages(path.join(root, "apps", "admin", "app")),
      ...pages(path.join(root, "apps", "portal", "app")),
    ];
    expect(files.length).toBeGreaterThan(30);
    for (const file of files) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const source = readFileSync(file, "utf8");
      expect(source, file).toMatch(/screenText\(|screenCopy\(/);
    }
  });
});
