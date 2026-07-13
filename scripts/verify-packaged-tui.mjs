import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const tempDir = await mkdtemp(path.join(tmpdir(), "opencode-mini-session-"));
const installDir = path.join(tempDir, "install");

try {
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--pack-destination", tempDir], {
      encoding: "utf8",
    }),
  );
  const tarball = path.join(tempDir, packed[0].filename);

  await mkdir(installDir);
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--no-package-lock", "--prefix", installDir, tarball],
    { stdio: "inherit" },
  );
  const entryPath = path.join(
    installDir,
    "node_modules",
    "opencode-mini-session",
    "dist",
    "index.js",
  );
  const distDir = path.dirname(entryPath);
  for (const file of await readdir(distDir, { recursive: true })) {
    if (!file.endsWith(".js")) continue;
    const source = await readFile(path.join(distDir, file), "utf8");
    if (/jsx(?:-dev)?-runtime/.test(source)) {
      throw new Error(`Packaged TUI output imports a JSX runtime: ${file}`);
    }
  }
  execFileSync(
    "bun",
    [
      "--eval",
      'import plugin from "opencode-mini-session/tui"; if (plugin.id !== "local.opencode-mini-session" || typeof plugin.tui !== "function") throw new Error("Invalid packaged TUI module");',
    ],
    { cwd: installDir, stdio: "inherit" },
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
