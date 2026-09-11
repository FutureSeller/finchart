// The banner is what lets a server file import this package without the
// module itself failing; a build that lost it would ship a bundle that fails
// there with "createContext only works in Client Components".
import { readFileSync } from "node:fs";

const head = readFileSync(new URL("../dist/index.mjs", import.meta.url), "utf8").slice(0, 32);
if (!head.startsWith('"use client";')) {
  console.error(`@finchart/react: dist/index.mjs must begin with "use client"; it begins with ${JSON.stringify(head)}`);
  process.exit(1);
}
