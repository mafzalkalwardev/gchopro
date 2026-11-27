import { expect, test } from "@playwright/test";

test("admin rejects a POST without CSRF and a cross-origin Origin", async ({ request }) => {
  const missing = await request.post("https://admin.localhost:3001/api/admin/auth/sudo", {
    headers: { origin: "https://admin.localhost:3001", "content-type": "application/json" },
    data: { password: "not-a-real-password", code: "000000" },
  });
  expect(missing.status()).toBe(403);

  const cross = await request.post("https://admin.localhost:3001/api/admin/auth/sudo", {
    headers: {
      origin: "https://evil.example",
      "x-csrf-token": "token",
      cookie: "__Host-gcho_csrf=token",
      "content-type": "application/json",
    },
    data: { password: "not-a-real-password", code: "000000" },
  });
  expect(cross.status()).toBe(403);
});
