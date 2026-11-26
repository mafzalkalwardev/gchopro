import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { loadRootEnv } from "../../scripts/load-root-env.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadRootEnv(root);

const nextConfig: NextConfig = {
  // Next's standalone tracer recreates pnpm symlinks. Windows denies that without
  // developer mode, so the Linux CI build is the standalone build.
  output: process.platform === "win32" ? undefined : "standalone",
  outputFileTracingRoot: root,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@gchopro/config"],
  serverExternalPackages: ["postgres", "ioredis", "@node-rs/argon2", "rate-limiter-flexible"],
};

export default nextConfig;
