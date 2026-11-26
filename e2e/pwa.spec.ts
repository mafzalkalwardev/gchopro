import { expect, test } from "@playwright/test";

test("portal manifest meets the installable PWA checks", async ({ page }) => {
  await page.goto("https://portal.localhost:3000/login");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const manifestResponse = await page.request.get(`https://portal.localhost:3000${href}`);
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    icons: { src: string; sizes: string }[];
  };
  expect(manifest.name.length).toBeGreaterThan(0);
  expect(manifest.short_name.length).toBeGreaterThan(0);
  expect(manifest.start_url).toBe("/");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.some((icon) => icon.sizes === "192x192")).toBe(true);
  expect(manifest.icons.some((icon) => icon.sizes === "512x512")).toBe(true);
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((item) => item.sizes === `${size}x${size}`);
    const bytes = await page.request.get(`https://portal.localhost:3000${icon?.src ?? ""}`);
    expect(bytes.ok()).toBe(true);
    const body = Buffer.from(await bytes.body());
    expect(body.readUInt32BE(16)).toBe(size);
    expect(body.readUInt32BE(20)).toBe(size);
  }
  const worker = await page.request.get("https://portal.localhost:3000/sw.js");
  expect(worker.ok()).toBe(true);
  expect(await worker.text()).toContain("fetch");
});
