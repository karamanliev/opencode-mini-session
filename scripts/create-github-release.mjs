import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { releasePolicy } from "./release-policy.mjs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const { prerelease } = releasePolicy(version);

execFileSync("gh", [
  "api", "-X", "POST", "repos/{owner}/{repo}/releases",
  "-f", `tag_name=v${version}`,
  "-f", `name=v${version}`,
  "-F", `prerelease=${prerelease}`,
  "-f", `make_latest=${prerelease ? "false" : "true"}`,
  "-F", "generate_release_notes=true",
], { stdio: "inherit" });
