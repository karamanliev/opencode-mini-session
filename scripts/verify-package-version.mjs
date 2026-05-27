import { readFileSync } from "node:fs";

const expected = process.argv[2];
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

if (!expected || expected.startsWith("v")) {
  throw new Error(`Expected a version without v prefix, got ${expected || "empty"}`);
}

if (pkg.version !== expected) {
  throw new Error(
    `Tag version ${expected} does not match package.json version ${pkg.version}`,
  );
}
