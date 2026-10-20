import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { releasePolicy } from "./release-policy.mjs";

const original = readFileSync("package.json", "utf8");
const pkg = JSON.parse(original);
const policy = releasePolicy(pkg.version);

try {
  pkg.publishConfig = {
    ...pkg.publishConfig,
    tag: policy.distTag,
    provenance: true,
    access: "public",
  };
  writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  execFileSync("npm", ["publish"], { stdio: "inherit" });
} finally {
  writeFileSync("package.json", original);
}
