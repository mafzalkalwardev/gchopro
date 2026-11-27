import assert from "node:assert/strict";
import { test } from "node:test";
import { endedBecause } from "./ended-because.ts";

test("login page names each session end", () => {
  assert.match(endedBecause("password_reset"), /reset the password/);
  assert.match(endedBecause("subscription_inactive"), /subscription is not active/);
  assert.match(endedBecause("user_disabled"), /account was disabled/);
  assert.match(endedBecause("sim_unassigned"), /line was unassigned/);
  assert.match(endedBecause("expired"), /subscription expired/);
  assert.match(endedBecause("admin_revoke"), /signed you out/);
  assert.equal(endedBecause("other"), "");
});
