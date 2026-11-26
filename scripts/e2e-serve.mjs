import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { request as httpRequest } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "gcho-tls-"));
const keyPath = join(dir, "key.pem");
const certPath = join(dir, "cert.pem");
execFileSync("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-keyout",
  keyPath,
  "-out",
  certPath,
  "-days",
  "1",
  "-nodes",
  "-subj",
  "/CN=localhost",
  "-addext",
  "subjectAltName=DNS:admin.localhost,DNS:portal.localhost,DNS:localhost,IP:127.0.0.1",
]);

function startApp(filter, port) {
  const child = spawn(
    "pnpm",
    [
      "--filter",
      filter,
      "exec",
      "next",
      "start",
      "--port",
      String(port),
      "--hostname",
      "127.0.0.1",
    ],
    { stdio: "inherit", env: process.env, shell: true },
  );
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) process.exit(code);
  });
}

function proxy(listenPort, targetPort) {
  createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (req, res) => {
    const upstream = httpRequest(
      {
        hostname: "127.0.0.1",
        port: targetPort,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (proxied) => {
        res.writeHead(proxied.statusCode ?? 502, proxied.headers);
        proxied.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.statusCode = 502;
      res.end();
    });
    req.pipe(upstream);
  }).listen(listenPort, "127.0.0.1");
}

startApp("@gchopro/admin", 3101);
startApp("@gchopro/portal", 3100);
proxy(3001, 3101);
proxy(3000, 3100);
