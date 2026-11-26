import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next's standalone tracer recreates pnpm symlinks. Windows denies that without
  // developer mode, so the Linux CI build is the standalone build.
  output: process.platform === "win32" ? undefined : "standalone",
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@gchopro/config"],
};

export default nextConfig;
