import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeBase32IgnorePadding } from "@oslojs/encoding";
import { generateTOTP } from "@oslojs/otp";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const adminBase = "https://admin.localhost:3001";
const portalBase = "https://portal.localhost:3000";
const gatewayBase = "https://gw.localhost:3000";
const opsPassword = process.env.SEED_OPS_PASSWORD ?? "";
const opsNext = "gchopro-e2e-ops-pass";
const userPassword = "gchopro-e2e-line-pass";
const userNext = "gchopro-e2e-line-pass2";
let statusPage: Page | null = null;

function code(secret: string): string {
  return generateTOTP(decodeBase32IgnorePadding(secret), 30, 6);
}

async function csrf(context: BrowserContext, origin: string): Promise<Record<string, string>> {
  const token = (await context.cookies(origin)).find(
    (cookie) => cookie.name === "__Host-gcho_csrf",
  );
  return { origin, "x-csrf-token": token?.value ?? "" };
}

async function accepted(
  response: Awaited<ReturnType<APIRequestContext["post"]>>,
  label: string,
): Promise<void> {
  if (response.ok()) return;
  let code = "unreadable";
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === "string") code = body.error;
  } catch {
    code = "unreadable";
  }
  throw new Error(`${label} ${response.status()} ${code}`);
}

async function adminSend(
  page: Page,
  context: BrowserContext,
  method: "post" | "patch",
  path: string,
  data?: unknown,
): Promise<Awaited<ReturnType<APIRequestContext["post"]>>> {
  const headers = await csrf(context, adminBase);
  if (method === "patch") {
    return page.request.patch(`${adminBase}${path}`, { headers, data });
  }
  return page.request.post(`${adminBase}${path}`, { headers, data });
}

function translateMock(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === "/languages") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify([{ code: "en" }, { code: "zh" }]));
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { q?: string };
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({ translatedText: body.q === "你好" ? "Hello there" : (body.q ?? "") }),
        );
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("mock address missing");
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function pollPending(
  request: APIRequestContext,
  deviceId: string,
  token: string,
  match: (message: { id: string; body: string }) => boolean,
): Promise<string> {
  const deadline = Date.now() + 45_000;
  let seen = "none";
  while (Date.now() < deadline) {
    const response = await request.get(`${gatewayBase}/api/devices/${deviceId}/pending`, {
      headers: { authorization: `Bearer ${token}`, "x-gateway-protocol": "2" },
    });
    await accepted(response, "pending");
    const body = (await response.json()) as { messages: { id: string; body: string }[] };
    if (body.messages.length > 0) seen = body.messages.map((message) => message.body).join(", ");
    const found = body.messages.find(match);
    if (found !== undefined) return found.id;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  let pageText = "";
  if (statusPage !== null) {
    await statusPage.reload();
    pageText = (await statusPage.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 400);
  }
  let workerTrace = "no worker trace";
  try {
    workerTrace = readFileSync(join(tmpdir(), "gchopro-e2e-worker.log"), "utf8").slice(-1500);
  } catch {
    workerTrace = "no worker trace";
  }
  throw new Error(`pending message did not arrive (${seen}) | ${pageText} | ${workerTrace}`);
}

async function compose(page: Page, to: string, body: string): Promise<void> {
  await page.getByRole("link", { name: "New", exact: true }).click();
  await page.getByLabel("To").fill(to);
  await page.getByLabel("Message").first().fill(body);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test("health checks answer before a session exists", async ({ request }) => {
  for (const url of [`${portalBase}/healthz`, `${adminBase}/healthz`]) {
    const response = await request.get(url);
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe("ok");
  }
});

test("a paired line sends, replies, pauses, retests, and expires", async ({ browser, request }) => {
  test.skip(opsPassword.length < 16, "SEED_OPS_PASSWORD is not configured");
  test.setTimeout(180_000);
  const mock = await translateMock();
  const adminContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const portalContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const adminPage = await adminContext.newPage();
  const portalPage = await portalContext.newPage();
  statusPage = portalPage;
  adminPage.setDefaultTimeout(20_000);
  adminPage.setDefaultNavigationTimeout(20_000);
  portalPage.setDefaultTimeout(20_000);
  portalPage.setDefaultNavigationTimeout(20_000);
  adminPage.on("response", (response) => {
    if (response.url().includes("/api/") || response.status() >= 400) {
      console.log(`lifecycle admin ${response.status()} ${response.url()}`);
    }
  });
  portalPage.on("response", (response) => {
    if (response.url().includes("/api/") || response.status() >= 400) {
      console.log(`lifecycle portal ${response.status()} ${response.url()}`);
    }
  });
  const stamp = randomBytes(3).toString("hex");
  const username = `line${stamp}`;
  const peer = "+923009991803";
  const limited = "+923009991804";
  const after = "+923009991805";

  try {
    const old = await request.post(`${gatewayBase}/api/devices/register`, {
      data: {
        protocolVersion: 1,
        code: "AA-BB-CC",
        name: "old",
        appVersion: "2.0.0",
        model: "e2e",
        androidSdk: 34,
      },
    });
    expect(old.status()).toBe(426);

    await adminPage.goto(`${adminBase}/login`);
    await expect(adminPage.locator("form")).toHaveAttribute("data-hydrated", "true");
    await adminPage.getByLabel("Username").fill("ops");
    await adminPage.getByLabel("Password").fill(opsPassword);
    const loginResponse = adminPage.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/auth/login") && response.request().method() === "POST",
    );
    await adminPage.getByRole("button", { name: "Sign in" }).click({ noWaitAfter: true });
    const signedIn = await loginResponse;
    await accepted(signedIn, "ops login");
    await adminPage.waitForURL("**/totp");
    await expect(adminPage.getByTestId("totp-secret")).not.toBeEmpty();
    const secret = (await adminPage.getByTestId("totp-secret").innerText()).trim();
    await adminPage.getByLabel("Authenticator code").fill(code(secret));
    await adminPage.getByRole("button", { name: "Verify" }).click();
    await expect(adminPage.getByTestId("recovery-codes")).toBeVisible();
    const recovery = (
      await adminPage.getByTestId("recovery-codes").locator("li").first().innerText()
    ).trim();
    await adminPage.getByRole("button", { name: "Continue" }).click();
    await adminPage.getByLabel("Current password").fill(opsPassword);
    await adminPage.getByLabel("New password").fill(opsNext);
    await adminPage.getByRole("button", { name: "Change password" }).click();
    await expect(adminPage.getByTestId("signed-in")).toHaveText("ops");

    const pairing = await adminSend(
      adminPage,
      adminContext,
      "post",
      "/api/admin/devices/pairings",
      {
        name: "Lifecycle phone",
      },
    );
    await accepted(pairing, "pairing");
    const paired = (await pairing.json()) as { data: { code: string } };
    const registered = await request.post(`${gatewayBase}/api/devices/register`, {
      data: {
        protocolVersion: 2,
        code: paired.data.code,
        name: "Lifecycle phone",
        appVersion: "2.0.0",
        model: "e2e",
        androidSdk: 34,
      },
    });
    await accepted(registered, "register");
    const device = (await registered.json()) as { id: string; token: string };
    const headers = { authorization: `Bearer ${device.token}`, "x-gateway-protocol": "2" };
    const reported = await request.post(`${gatewayBase}/api/devices/${device.id}/sims`, {
      headers,
      data: {
        reportedAt: new Date().toISOString(),
        slotsOnDevice: 2,
        sims: [
          {
            subscriptionId: 801,
            slotIndex: 0,
            isEmbedded: false,
            number: "+923009991801",
            carrierName: "Jazz",
            countryIso: "PK",
          },
          {
            subscriptionId: 802,
            slotIndex: 1,
            isEmbedded: false,
            number: "+923009991802",
            carrierName: "Jazz",
            countryIso: "PK",
          },
        ],
      },
    });
    await accepted(reported, "sims");
    const sims = (await reported.json()) as { sims: { simId: string; subscriptionId: number }[] };
    const simId = sims.sims.find((sim) => sim.subscriptionId === 801)?.simId;
    if (simId === undefined) throw new Error("sim was not reported");
    await accepted(
      await request.post(`${gatewayBase}/api/devices/${device.id}/heartbeat`, {
        headers,
        data: {
          battery: 90,
          charging: true,
          network: "wifi",
          appVersion: "2.0.0",
          androidSdk: 34,
          activeModemCount: 2,
          uptimeSec: 20,
        },
      }),
      "heartbeat",
    );

    const policy = await adminSend(adminPage, adminContext, "post", "/api/admin/policies", {
      name: `All day ${stamp}`,
      gapBaseSeconds: 6,
      gapJitterSeconds: 0,
      perMinute: 10,
      perHour: 50,
      perDay: 500,
      segmentsPerDay: 500,
      maxGroupRecipients: 50,
      windowStart: "00:00:00",
      windowEnd: "23:59:59",
      windowDays: [1, 2, 3, 4, 5, 6, 7],
      windowTimezoneMode: "user",
      overLimitAction: "hold",
    });
    await accepted(policy, "policy");
    const policyId = ((await policy.json()) as { data: { id: string } }).data.id;
    await accepted(
      await adminSend(adminPage, adminContext, "patch", `/api/admin/sims/${simId}`, {
        rateLimitPolicyId: policyId,
      }),
      "sim policy",
    );
    const created = await adminSend(adminPage, adminContext, "post", "/api/admin/users", {
      username,
      displayName: "Lifecycle line",
      password: userPassword,
      simId,
      policyId,
      userLanguage: "zh",
      recipientLanguage: "en",
      translationEnabled: true,
      timezone: "UTC",
      allowExport: true,
      allowSelfPasswordChange: true,
      subscription: { planUnit: "month", planQuantity: 1, expiryBehavior: "block" },
    });
    await accepted(created, "user");
    const user = ((await created.json()) as { data: { user: { subscription: { id: string } } } })
      .data.user;

    await portalPage.goto(`${portalBase}/login`);
    await expect(portalPage.locator("form")).toHaveAttribute("data-hydrated", "true");
    await portalPage.getByLabel("Username").fill(username);
    await portalPage.getByLabel("Password").fill(userPassword);
    const portalLogin = portalPage.waitForResponse(
      (response) =>
        response.url().includes("/api/portal/auth/login") && response.request().method() === "POST",
    );
    await portalPage.getByRole("button", { name: "Sign in" }).click({ noWaitAfter: true });
    await accepted(await portalLogin, "portal login");
    await portalPage.waitForURL("**/password");
    await portalPage.getByLabel("Current password").fill(userPassword);
    await portalPage.getByLabel("New password").fill(userNext);
    await portalPage.getByRole("button", { name: "Change password" }).click();
    await portalPage.getByRole("button", { name: "Accept" }).click();
    await expect(portalPage.getByTestId("signed-in")).toBeVisible();

    const granted = await adminSend(adminPage, adminContext, "post", "/api/admin/auth/sudo", {
      password: opsNext,
      recoveryCode: recovery,
    });
    await accepted(granted, "sudo");
    await accepted(
      await adminSend(adminPage, adminContext, "patch", "/api/admin/settings/translation", {
        value: {
          provider: "libretranslate",
          deepl: { plan: "free" },
          google: {},
          libretranslate: { url: mock.url },
          preview_before_send: true,
        },
      }),
      "translation",
    );
    await accepted(
      await adminSend(adminPage, adminContext, "patch", "/api/admin/settings/test_numbers", {
        value: ["+923001234567"],
      }),
      "test numbers",
    );

    await accepted(
      await request.post(`${gatewayBase}/api/devices/${device.id}/heartbeat`, {
        headers,
        data: {
          battery: 90,
          charging: true,
          network: "wifi",
          appVersion: "2.0.0",
          androidSdk: 34,
          activeModemCount: 2,
          uptimeSec: 25,
        },
      }),
      "heartbeat before send",
    );
    await compose(portalPage, peer, "你好");
    await portalPage.waitForURL("**/c/**");
    await expect(portalPage.getByText("你好")).toBeVisible();
    const outbound = await pollPending(
      request,
      device.id,
      device.token,
      (message) => message.body === "Hello there",
    );
    await accepted(
      await request.post(`${gatewayBase}/api/devices/${device.id}/report`, {
        headers,
        data: {
          id: outbound,
          event: "delivered",
          partIndex: 0,
          partCount: 1,
          subscriptionId: 801,
          at: new Date().toISOString(),
        },
      }),
      "delivered",
    );
    await accepted(
      await request.post(`${gatewayBase}/api/devices/${device.id}/inbox`, {
        headers,
        data: {
          messages: [
            {
              providerId: `in-${stamp}`,
              subscriptionId: 801,
              address: peer,
              body: "Reply",
              direction: "in",
              receivedAt: new Date().toISOString(),
            },
          ],
        },
      }),
      "reply",
    );
    await expect
      .poll(async () => {
        await portalPage.reload();
        return portalPage.getByText("Reply").count();
      })
      .toBeGreaterThan(0);

    await accepted(
      await request.post(`${gatewayBase}/api/devices/${device.id}/heartbeat`, {
        headers,
        data: {
          battery: 90,
          charging: true,
          network: "wifi",
          appVersion: "2.0.0",
          androidSdk: 34,
          activeModemCount: 2,
          uptimeSec: 30,
        },
      }),
      "heartbeat before stop",
    );
    await accepted(
      await request.post(`${gatewayBase}/api/devices/${device.id}/inbox`, {
        headers,
        data: {
          messages: [
            {
              providerId: `stop-${stamp}`,
              subscriptionId: 801,
              address: peer,
              body: "STOP",
              direction: "in",
              receivedAt: new Date().toISOString(),
            },
          ],
        },
      }),
      "stop",
    );
    await portalPage.reload();
    await expect(portalPage.getByText("Compose is turned off.")).toBeVisible();
    await compose(portalPage, peer, "after stop");
    await expect(portalPage.getByText("This number has opted out.")).toBeVisible();
    const confirmation = await pollPending(request, device.id, device.token, (message) =>
      message.body.includes("unsubscribed"),
    );
    await accepted(
      await request.post(`${gatewayBase}/api/devices/${device.id}/report`, {
        headers,
        data: {
          id: confirmation,
          event: "delivered",
          partIndex: 0,
          partCount: 1,
          subscriptionId: 801,
          at: new Date().toISOString(),
        },
      }),
      "confirmation",
    );

    await accepted(
      await request.post(`${gatewayBase}/api/devices/${device.id}/heartbeat`, {
        headers,
        data: {
          battery: 90,
          charging: true,
          network: "wifi",
          appVersion: "2.0.0",
          androidSdk: 34,
          activeModemCount: 2,
          uptimeSec: 40,
        },
      }),
      "heartbeat again",
    );
    for (const mark of ["one", "two"]) {
      await compose(portalPage, limited, `limit ${mark}`);
      await portalPage.waitForURL("**/c/**");
      const id = await pollPending(
        request,
        device.id,
        device.token,
        (message) => message.body === `limit ${mark}`,
      );
      await accepted(
        await request.post(`${gatewayBase}/api/devices/${device.id}/report`, {
          headers,
          data: {
            id,
            event: "failed",
            partIndex: 0,
            partCount: 1,
            subscriptionId: 801,
            resultName: "RESULT_ERROR_LIMIT_EXCEEDED",
            at: new Date().toISOString(),
          },
        }),
        "limit",
      );
    }
    await compose(portalPage, after, "held");
    await expect(portalPage.getByText("The assigned line is not available.")).toBeVisible();

    const retest = await adminSend(
      adminPage,
      adminContext,
      "post",
      `/api/admin/sims/${simId}/retest`,
      {
        testNumber: "+923001234567",
      },
    );
    await accepted(retest, "retest");
    const retestId = ((await retest.json()) as { data: { messageId: string } }).data.messageId;
    await pollPending(request, device.id, device.token, (message) => message.id === retestId);
    await accepted(
      await request.post(`${gatewayBase}/api/devices/${device.id}/report`, {
        headers,
        data: {
          id: retestId,
          event: "sent",
          partIndex: 0,
          partCount: 1,
          subscriptionId: 801,
          at: new Date().toISOString(),
        },
      }),
      "retest report",
    );
    await compose(portalPage, after, "after retest");
    await portalPage.waitForURL("**/c/**");
    await expect(portalPage.getByText("after retest")).toBeVisible();

    await accepted(
      await adminSend(
        adminPage,
        adminContext,
        "post",
        `/api/admin/subscriptions/${user.subscription.id}/disable`,
        {
          reason: "e2e expiry",
        },
      ),
      "disable",
    );
    await portalContext.clearCookies();
    await portalPage.goto(`${portalBase}/login`);
    await expect(portalPage.locator("form")).toHaveAttribute("data-hydrated", "true");
    await portalPage.getByLabel("Username").fill(username);
    await portalPage.getByLabel("Password").fill(userNext);
    await portalPage.getByRole("button", { name: "Sign in" }).click();
    await expect(portalPage.getByText("This subscription cannot sign in.")).toBeVisible();
  } finally {
    await new Promise<void>((resolve, reject) => {
      mock.server.close((error) => (error ? reject(error) : resolve()));
    });
    await adminContext.close();
    await portalContext.close();
  }
});
