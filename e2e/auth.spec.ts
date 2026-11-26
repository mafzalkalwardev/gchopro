import { decodeBase32IgnorePadding } from "@oslojs/encoding";
import { generateTOTP } from "@oslojs/otp";
import { expect, test } from "@playwright/test";

test("admin authenticator, portal password change, and revocation under 5 seconds", async ({
  browser,
}) => {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "";
  const demoPassword = process.env.SEED_DEMO_PASSWORD ?? "";
  const admin = await browser.newContext({ ignoreHTTPSErrors: true });
  const adminPage = await admin.newPage();
  adminPage.on("console", (msg) => {
    console.log(`admin console ${msg.type()}: ${msg.text()}`);
  });
  adminPage.on("pageerror", (error) => {
    console.log(`admin pageerror: ${error.message}`);
  });
  adminPage.on("response", (response) => {
    if (response.url().includes("/api/") || response.status() >= 400) {
      console.log(`admin response ${response.status()} ${response.url()}`);
    }
  });
  await adminPage.goto("https://admin.localhost:3001/login");
  await expect(adminPage.locator("form")).toHaveAttribute("data-hydrated", "true");
  await adminPage.getByLabel("Username").fill(process.env.SEED_ADMIN_USERNAME ?? "admin");
  await adminPage.getByLabel("Password").fill(adminPassword);
  await adminPage.getByRole("button", { name: "Sign in" }).click();
  await adminPage.waitForURL("**/totp");
  await expect(adminPage.getByTestId("totp-secret")).not.toBeEmpty();
  const secret = (await adminPage.getByTestId("totp-secret").innerText()).trim();
  await adminPage
    .getByLabel("Authenticator code")
    .fill(generateTOTP(decodeBase32IgnorePadding(secret), 30, 6));
  await adminPage.getByRole("button", { name: "Verify" }).click();
  await expect(adminPage.getByTestId("recovery-codes")).toBeVisible();
  const recoveryCode = (
    await adminPage.getByTestId("recovery-codes").locator("li").first().innerText()
  ).trim();
  await adminPage.getByRole("button", { name: "Continue" }).click();
  await adminPage.getByLabel("Current password").fill(adminPassword);
  await adminPage.getByLabel("New password").fill("gchopro-e2e-admin-pass");
  await adminPage.getByRole("button", { name: "Change password" }).click();
  await expect(adminPage.getByTestId("signed-in")).toHaveText("admin");

  const portal = await browser.newContext({ ignoreHTTPSErrors: true });
  const portalPage = await portal.newPage();
  portalPage.on("console", (msg) => {
    console.log(`portal console ${msg.type()}: ${msg.text()}`);
  });
  portalPage.on("pageerror", (error) => {
    console.log(`portal pageerror: ${error.message}`);
  });
  await portalPage.goto("https://portal.localhost:3000/login");
  await expect(portalPage.locator("form")).toHaveAttribute("data-hydrated", "true");
  await portalPage.getByLabel("Username").fill("demo1");
  await portalPage.getByLabel("Password").fill(demoPassword);
  await portalPage.getByRole("button", { name: "Sign in" }).click();
  await portalPage.getByLabel("Current password").fill(demoPassword);
  await portalPage.getByLabel("New password").fill("gchopro-e2e-portal-pass");
  await portalPage.getByRole("button", { name: "Change password" }).click();
  await portalPage.getByRole("button", { name: "Accept" }).click();
  await expect(portalPage.getByTestId("sse")).toHaveText("open");
  const userId = (await portalPage.getByTestId("user-id").innerText()).trim();
  const oldPortal =
    (await portal.cookies("https://portal.localhost")).find(
      (cookie) => cookie.name === "__Host-gcho_portal",
    )?.value ?? "";

  const resetCsrf = (await admin.cookies("https://admin.localhost")).find(
    (cookie) => cookie.name === "__Host-gcho_csrf",
  );
  const sudo = await adminPage.request.post("https://admin.localhost:3001/api/admin/auth/sudo", {
    headers: {
      origin: "https://admin.localhost:3001",
      "x-csrf-token": resetCsrf?.value ?? "",
      "content-type": "application/json",
    },
    data: { password: "gchopro-e2e-admin-pass", recoveryCode },
  });
  expect(sudo.status()).toBe(200);
  const resetStarted = Date.now();
  const reset = await adminPage.request.post(
    `https://admin.localhost:3001/api/admin/users/${userId}/reset-password`,
    {
      headers: {
        origin: "https://admin.localhost:3001",
        "x-csrf-token": resetCsrf?.value ?? "",
        "content-type": "application/json",
      },
      data: { newPassword: "gchopro-e2e-reset-pass" },
    },
  );
  expect(reset.status()).toBe(200);
  await portalPage.waitForURL(
    (url) => url.pathname === "/login" && url.searchParams.get("reason") === "password_reset",
  );
  expect(Date.now() - resetStarted).toBeLessThan(5000);
  await expect(portalPage.getByText("administrator reset the password")).toBeVisible();
  const staleContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const stale = await staleContext.request.get("https://portal.localhost:3000/api/portal/me", {
    headers: { cookie: `__Host-gcho_portal=${oldPortal}` },
  });
  expect(stale.status()).toBe(401);
  await staleContext.close();
  await expect(portalPage.locator("form")).toHaveAttribute("data-hydrated", "true");
  await portalPage.getByLabel("Username").fill("demo1");
  await portalPage.getByLabel("Password").fill("gchopro-e2e-portal-pass");
  await portalPage.getByRole("button", { name: "Sign in" }).click();
  await expect(portalPage.getByText("Those credentials were not accepted.")).toBeVisible();
  await portalPage.getByLabel("Password").fill("gchopro-e2e-reset-pass");
  await portalPage.getByRole("button", { name: "Sign in" }).click();
  await portalPage.getByLabel("Current password").fill("gchopro-e2e-reset-pass");
  await portalPage.getByLabel("New password").fill("gchopro-e2e-after-reset");
  await portalPage.getByRole("button", { name: "Change password" }).click();
  const accept = portalPage.getByRole("button", { name: "Accept" });
  if (await accept.isVisible()) await accept.click();
  await expect(portalPage.getByTestId("sse")).toHaveText("open");

  const csrf = (await admin.cookies("https://admin.localhost")).find(
    (cookie) => cookie.name === "__Host-gcho_csrf",
  );
  const started = Date.now();
  const response = await adminPage.request.post(
    `https://admin.localhost:3001/api/admin/users/${userId}/revoke-sessions`,
    {
      headers: {
        origin: "https://admin.localhost:3001",
        "x-csrf-token": csrf?.value ?? "",
      },
    },
  );
  expect(response.status()).toBe(204);
  await portalPage.waitForURL(
    (url) => url.pathname === "/login" && url.searchParams.get("reason") === "admin_revoke",
  );
  expect(Date.now() - started).toBeLessThan(5000);
});
