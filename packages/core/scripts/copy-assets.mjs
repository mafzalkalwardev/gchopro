import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const destination = join(root, "../dist/auth");
mkdirSync(destination, { recursive: true });
copyFileSync(
  join(root, "../src/auth/common-passwords.txt"),
  join(destination, "common-passwords.txt"),
);
