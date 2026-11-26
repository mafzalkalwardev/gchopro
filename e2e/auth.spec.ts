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
