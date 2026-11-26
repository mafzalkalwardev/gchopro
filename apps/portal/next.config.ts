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
  webpack: (config, { isServer, nextRuntime }) => {
    if (!isServer || nextRuntime === "edge") return config;
    const workspace = ["@gchopro/core", "@gchopro/db"];
    const markExternal = (...args: unknown[]) => {
      const callback = args.at(-1) as (error?: null, result?: string) => void;
      const request =
        typeof args[0] === "string"
          ? String(args[1] ?? "")
          : String((args[0] as { request?: string }).request ?? "");
      const external = workspace.some((name) => request === name || request.startsWith(`${name}/`));
      if (external) {
        callback(null, `module ${request}`);
        return;
      }
      callback();
    };
    if (Array.isArray(config.externals)) config.externals.push(markExternal);
    else config.externals = config.externals ? [config.externals, markExternal] : [markExternal];
    return config;
  },
};

export default nextConfig;
