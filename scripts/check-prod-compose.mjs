import { readFileSync } from "node:fs";

const file = process.argv[2];
if (file === undefined) {
  console.error("usage: check-prod-compose.mjs <compose-config.json>");
  process.exit(1);
}

// The path is the script's own argument, not a request value.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const config = JSON.parse(readFileSync(file, "utf8"));
const services = config.services ?? {};
const named = new Map([
  ["postgres", services.postgres],
  ["redis", services.redis],
  ["caddy", services.caddy],
  ["admin", services.admin],
  ["portal", services.portal],
  ["worker", services.worker],
]);

function portsOf(name) {
  const ports = named.get(name)?.ports;
  return Array.isArray(ports) ? ports : [];
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (named.get("postgres") === undefined) fail("postgres is missing");
if (named.get("redis") === undefined) fail("redis is missing");
if (named.get("caddy") === undefined) fail("caddy is missing");
if (portsOf("postgres").length > 0) fail("postgres publishes a port");
if (portsOf("redis").length > 0) fail("redis publishes a port");
const caddyPorts = portsOf("caddy").map((port) => String(port.published ?? port.target ?? ""));
if (!caddyPorts.includes("80") || !caddyPorts.includes("443"))
  fail("caddy must publish 80 and 443");

for (const name of ["admin", "portal", "worker"]) {
  const service = named.get(name);
  if (service === undefined) fail(`${name} is missing`);
  if (service.read_only !== true) fail(`${name} is not read-only`);
  if (service.user !== "node") fail(`${name} does not run as node`);
}

console.log("prod compose config ok");
