import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const versionArg = process.argv[2];

if (!versionArg) {
  throw new Error("Usage: npm run release <version|major|minor|patch|prerelease>");
}

if (versionArg.startsWith("v")) {
  throw new Error("Pass the version without the v prefix.");
}

function read(command, args = []) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function run(command, args = []) {
  execFileSync(command, args, { stdio: "inherit" });
}

const branchLine = read("git", ["branch"])
  .split("\n")
  .find((line) => line.startsWith("* "));
const branch = branchLine?.slice(2).trim();

if (!branch || branch.startsWith("(")) {
  throw new Error("Release from a named branch, not a detached HEAD.");
}

run("npm", ["run", "test"]);
run("npm", ["run", "typecheck"]);

run("npm", ["version", "--no-git-tag-version", versionArg]);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const tag = `v${pkg.version}`;

run("git", ["commit", "-m", tag, "--", "package.json", "package-lock.json"]);
run("git", ["tag", tag]);

run("git", ["push", "origin", branch]);
run("git", ["push", "origin", "tag", tag]);
